import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApiResponse } from '../shared/models';
import type { SubtitleCue } from '../shared/narrationPlan';
import type { ShortsJob, ShortsItem, ShortsRecipe, ShortsStartInput } from '../shared/shortsTypes';
import { isShortsId, parseShortsAction, parseShortsStart } from '../shared/shortsValidators';
import { buildShortsTimeline } from '../shared/shortsRecipe';
import { selectShortsCandidates, type ShortsSelectionProvider } from '../shared/shortsCandidateSelection';
import type { MediaAsset } from '../shared/timelineTypes';
import { isPlainRecord, hasAllowedKeys } from '../shared/timelineValidationPrimitives';
import type { ProjectStore } from './projectStore';
import type { AssetLibraryStore } from './assetLibraryStore';
import type { ExportIpcService } from './exportIpcService';
import type { TranscriptionService } from './transcriptionService';
import { fail, ok } from './ipcResponses';
import { hashExportOutput } from './exportOutputFiles';

type Dependencies = {
  projects: ProjectStore;
  assets: AssetLibraryStore;
  exports: ExportIpcService;
  transcription: TranscriptionService;
  jobsDirectory: string;
  providerFor: (input: ShortsStartInput) => ShortsSelectionProvider;
  /** Main-only media probe; metadata supplied by the renderer is not measurement. */
  measureSource: (projectId: string, assetId: string) => Promise<{ durationMs: number; width: number; height: number }>;
  pollMs?: number;
};
type ActiveRun = { controller: AbortController; promise: Promise<void>; settling: boolean };
const busyStages = new Set(['transcribing', 'selecting', 'creating', 'exporting', 'cancelling']);

/** One local source, isolated editable projects, and explicitly separate export runs. */
export class ShortsService {
  private readonly jobs = new Map<string, ShortsJob>();
  private readonly active = new Map<string, ActiveRun>();
  private readonly writes = new Map<string, Promise<void>>();
  private loaded: Promise<void> | undefined;
  constructor(private readonly deps: Dependencies) {}

  private async load(): Promise<void> {
    this.loaded ??= (async () => {
      await mkdir(this.deps.jobsDirectory, { recursive: true, mode: 0o700 });
      for (const name of await readdir(this.deps.jobsDirectory)) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        try {
          const job = JSON.parse(await readFile(join(this.deps.jobsDirectory, name), 'utf8')) as ShortsJob;
          if (job.id !== name.slice(0, -5) || !isShortsId(job.sourceProjectId) || !isShortsId(job.sourceAssetId) || !Array.isArray(job.items)) continue;
          // Interrupted processes are never silently resumed, and cleanup is not asserted after a crash.
          this.jobs.set(job.id, busyStages.has(job.stage) ? { ...job, stage: 'failed', cleanupComplete: false, errorCode: 'interrupted', error: 'This run was interrupted. Review retained results and start a new run.' } : job);
        } catch { /* A damaged record cannot grant access to a project or start work. */ }
      }
    })();
    return this.loaded;
  }
  private async save(job: ShortsJob, publish = true): Promise<void> {
    if (publish) this.jobs.set(job.id, job);
    const prior = this.writes.get(job.id) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(async () => {
      const target = join(this.deps.jobsDirectory, `${job.id}.json`);
      const temporary = `${target}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(job), { mode: 0o600 });
        await rename(temporary, target);
      } finally { await rm(temporary, { force: true }); }
    });
    this.writes.set(job.id, next);
    await next;
  }
  private async patch(id: string, patch: Partial<ShortsJob>): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Run missing.');
    await this.save({ ...job, ...patch, updatedAt: new Date().toISOString() });
  }
  private fresh(sourceProjectId: string, sourceAssetId: string, stage: ShortsJob['stage']): ShortsJob {
    const now = new Date().toISOString();
    return { id: randomUUID(), sourceProjectId, sourceAssetId, stage, createdAt: now, updatedAt: now, cleanupComplete: false, items: [] };
  }
  private launch(job: ShortsJob, work: (signal: AbortSignal) => Promise<void>): void {
    const controller = new AbortController();
    const promise = Promise.resolve().then(async () => {
      let cleanupComplete = true;
      try {
        await work(controller.signal);
      } catch (error) {
        cleanupComplete = error instanceof Error && error.name === 'AbortError';
        if (!controller.signal.aborted) await this.patch(job.id, { stage: 'failed', errorCode: 'storage_failed', failureKind: 'storage', error: 'The local shorts operation could not be completed safely.' });
      } finally {
        // Work and cleanup are over. A late cancellation cannot rewrite the
        // final snapshot while its durable publication is in flight.
        const run = this.active.get(job.id);
        if (run) run.settling = true;
        const finalJob: ShortsJob = { ...this.jobs.get(job.id)!, ...(controller.signal.aborted ? { stage: 'cancelled' as const } : {}), cleanupComplete, updatedAt: new Date().toISOString() };
        // Persist before atomically publishing cleanup truth and releasing the gate.
        // An observer can then start the next action and reopen the same durable state.
        await this.save(finalJob, false);
        this.active.delete(job.id);
        this.jobs.set(job.id, finalJob);
      }
    }).catch(() => { this.active.delete(job.id); });
    this.active.set(job.id, { controller, promise, settling: false });
  }
  private delay(): Promise<void> { return new Promise(resolve => setTimeout(resolve, this.deps.pollMs ?? 100)); }

  async start(payload: unknown): Promise<ApiResponse<ShortsJob>> {
    const input = parseShortsStart(payload);
    if (!input) return fail('INVALID_INPUT', 'Choose an imported local video, model and valid selection bounds.');
    await this.load();
    const project = await this.deps.projects.open(input.projectId);
    const asset = project?.assets.find(item => item.id === input.assetId);
    if (!project || asset?.kind !== 'video') return fail('ASSET_NOT_FOUND', 'Choose one video imported into this project.');
    const job = this.fresh(project.id, asset.id, 'selecting');
    await this.save(job);
    this.launch(job, signal => this.select(job.id, input, asset, project.ai?.transcriptionDraft?.sourceAssetId === asset.id ? project.ai.transcriptionDraft.cues : undefined, signal));
    return ok(job);
  }
  private async select(id: string, input: ShortsStartInput, asset: MediaAsset, existing: readonly SubtitleCue[] | undefined, signal: AbortSignal): Promise<void> {
    let transcriptionId: string | undefined;
    try {
      const opened = await this.deps.assets.openPlaybackSource(input.projectId, asset.id);
      if (!opened) throw new Error('Source unavailable.');
      let sourceSha256: string;
      try { sourceSha256 = (await hashExportOutput(opened.filePath)).sha256; }
      finally { await opened.file.close(); }
      const measured = await this.deps.measureSource(input.projectId, asset.id);
      signal.throwIfAborted();
      if (!Number.isSafeInteger(measured.durationMs) || measured.durationMs <= 0 || !Number.isSafeInteger(measured.width) || !Number.isSafeInteger(measured.height) || measured.width <= 0 || measured.height <= 0) throw new Error('Source measurement unavailable.');
      let cues = existing;
      if (!cues?.length) {
        const runtime = await this.deps.transcription.runtimeStatus();
        signal.throwIfAborted();
        if (!runtime.ready) {
          await this.patch(id, { stage: 'failed', failureKind: 'configuration', errorCode: 'transcription_not_configured', error: 'Configure the local whisper.cpp executable and model in Settings before creating shorts.' });
          return;
        }
        await this.patch(id, { stage: 'transcribing' });
        const response = await this.deps.transcription.start({ projectId: input.projectId, assetId: input.assetId, language: 'auto' });
        if (!response.ok) throw new Error('Transcription start failed.');
        transcriptionId = response.value.id;
        for (;;) {
          if (signal.aborted) this.deps.transcription.cancel(transcriptionId);
          const transcription = this.deps.transcription.get(transcriptionId);
          if (!transcription) throw new Error('Transcription missing.');
          await this.patch(id, { transcription: { jobId: transcriptionId, status: transcription.status, progressPercent: transcription.progressPercent } });
          if (this.deps.transcription.isSettled(transcriptionId)) {
            signal.throwIfAborted();
            if (transcription.status !== 'completed' || !transcription.draft) {
              await this.patch(id, { stage: 'failed', failureKind: 'transcription', errorCode: 'transcription_failed', error: 'Local transcription failed or produced no speech. Inspect the source and transcription configuration.' });
              return;
            }
            cues = transcription.draft.cues;
            break;
          }
          await this.delay();
        }
      }
      signal.throwIfAborted();
      await this.patch(id, { stage: 'selecting', captions: cues });
      try {
        // Wait for provider settlement too: selection cancellation races alone do not prove transport cleanup.
        let providerWork: Promise<unknown> | undefined;
        const provider = this.deps.providerFor(input);
        const tracked: ShortsSelectionProvider = (selectionInput, providerSignal) => (providerWork = provider(selectionInput, providerSignal));
        let selection;
        try {
          selection = await selectShortsCandidates({ sourceAssetId: asset.id, sourceDurationMs: measured.durationMs, transcript: cues, sceneClues: [],
            ...(input.requestedCount === undefined ? {} : { requestedCount: input.requestedCount }),
            ...(input.minDurationMs === undefined ? {} : { minDurationMs: input.minDurationMs }),
            ...(input.maxDurationMs === undefined ? {} : { maxDurationMs: input.maxDurationMs }) }, tracked, signal);
        } finally { await providerWork?.catch(() => undefined); }
        signal.throwIfAborted();
        const recipes: ShortsRecipe[] = selection.candidates.map(candidate => ({ version: 1, sourceProjectId: input.projectId, sourceAssetId: asset.id, sourceDurationMs: measured.durationMs, sourceSha256, sourceDimensions: { width: measured.width, height: measured.height },
          candidate, evidenceSnapshot: cues!.filter(cue => cue.startMs < candidate.endMs && cue.endMs > candidate.startMs), output: { width: 1080, height: 1920, frameRate: 30, fit: 'contain' }, createdAt: new Date().toISOString() }));
        await this.patch(id, { stage: 'review', selection, recipes });
      } catch (error) {
        signal.throwIfAborted();
        const configuration = error instanceof Error && /missing|connect.*settings|authentication|unavailable for Edit Agent/i.test(error.message);
        await this.patch(id, { stage: 'failed', failureKind: configuration ? 'configuration' : 'provider', errorCode: configuration ? 'llm_not_configured' : 'provider_failed', error: configuration ? 'Connect the selected model provider in Settings.' : 'The selected model failed or returned invalid evidence. Retry with a configured model.' });
      }
    } finally {
      if (transcriptionId && !this.deps.transcription.isSettled(transcriptionId)) {
        this.deps.transcription.cancel(transcriptionId);
        while (!this.deps.transcription.isSettled(transcriptionId)) await this.delay();
      }
    }
  }
  async get(payload: unknown): Promise<ApiResponse<ShortsJob>> {
    const input = parseShortsAction(payload);
    if (!input) return fail('INVALID_INPUT', 'A valid shorts job id is required.');
    await this.load();
    const job = this.jobs.get(input.jobId);
    return job ? ok(structuredClone(job)) : fail('JOB_NOT_FOUND', 'The shorts run was not found.');
  }
  async list(payload: unknown): Promise<ApiResponse<readonly ShortsJob[]>> {
    if (!isPlainRecord(payload) || !hasAllowedKeys(payload, ['projectId']) || !isShortsId(payload.projectId)) return fail('INVALID_INPUT', 'A project id is required.');
    await this.load();
    return ok(structuredClone([...this.jobs.values()].filter(job => job.sourceProjectId === payload.projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
  }
  async cancel(payload: unknown): Promise<ApiResponse<{ accepted: boolean }>> {
    const input = parseShortsAction(payload);
    if (!input) return fail('INVALID_INPUT', 'A valid shorts job id is required.');
    await this.load();
    const job = this.jobs.get(input.jobId);
    if (!job) return fail('JOB_NOT_FOUND', 'The shorts run was not found.');
    const active = this.active.get(job.id);
    if (!active || active.settling) return ok({ accepted: false });
    active.controller.abort();
    await this.patch(job.id, { stage: 'cancelling', cleanupComplete: false });
    return ok({ accepted: true });
  }
  async materialize(payload: unknown): Promise<ApiResponse<ShortsJob>> {
    const input = parseShortsAction(payload, 'candidateIds');
    if (!input) return fail('INVALID_INPUT', 'Choose one to five distinct candidates.');
    await this.load();
    const job = this.jobs.get(input.jobId);
    if (!job) return fail('JOB_NOT_FOUND', 'The shorts run was not found.');
    if (this.active.has(job.id) || job.stage !== 'review' || !job.recipes || input.ids.some(id => !job.recipes?.some(recipe => recipe.candidate.id === id))) return fail('INVALID_INPUT', 'Wait for selection and review valid candidates before creating projects.');
    await this.patch(job.id, { stage: 'creating', cleanupComplete: false, items: input.ids.map(candidateId => ({ candidateId, status: 'creating' })) });
    this.launch(job, async signal => {
      for (const candidateId of input.ids) {
        if (signal.aborted) break;
        const recipe = job.recipes!.find(item => item.candidate.id === candidateId)!;
        let resultProjectId: string | undefined;
        try {
          const source = await this.deps.assets.openPlaybackSource(job.sourceProjectId, job.sourceAssetId);
          if (!source) throw new Error('Source unavailable.');
          try {
            const sourceAsset = await this.deps.projects.getAsset(job.sourceProjectId, job.sourceAssetId);
            if (!sourceAsset) throw new Error('Source missing.');
            signal.throwIfAborted();
            const project = await this.deps.projects.create({ name: `Short ${candidateId}` });
            resultProjectId = project.id;
            const imported = await this.deps.assets.import({ projectId: project.id, sourcePath: source.filePath, displayName: sourceAsset.displayName, kind: 'video', mimeType: sourceAsset.mimeType });
            const copied = await this.deps.assets.openPlaybackSource(project.id, imported.id);
            if (!copied) throw new Error('Copy unavailable.');
            try {
              if ((await hashExportOutput(copied.filePath)).sha256 !== recipe.sourceSha256) throw new Error('Source changed since selection; select again.');
            } finally { await copied.file.close(); }
            signal.throwIfAborted();
            const asset = await this.deps.assets.updateMetadata({ projectId: project.id, assetId: imported.id, ...recipe.sourceDimensions, durationMs: recipe.sourceDurationMs });
            await this.deps.projects.saveTimeline(project.id, buildShortsTimeline(asset, recipe));
            signal.throwIfAborted();
            await this.item(job.id, candidateId, { status: 'ready', resultProjectId: project.id });
            resultProjectId = undefined; // Ownership transferred to the saved successful result.
          } finally { await source.file.close(); }
        } catch {
          if (resultProjectId) await this.deps.projects.delete(resultProjectId);
          await this.item(job.id, candidateId, { status: signal.aborted ? 'cancelled' : 'failed', error: signal.aborted ? 'Cancelled.' : 'The isolated project could not be created.' });
        }
      }
      if (signal.aborted) {
        for (const item of this.jobs.get(job.id)!.items) if (item.status === 'creating') await this.item(job.id, item.candidateId, { status: 'cancelled' });
      } else await this.finish(job.id);
    });
    return ok(structuredClone(this.jobs.get(job.id)!));
  }
  private async item(id: string, candidateId: string, patch: Partial<ShortsItem>): Promise<void> {
    await this.patch(id, { items: this.jobs.get(id)!.items.map(item => item.candidateId === candidateId ? { ...item, ...patch } : item) });
  }
  private async finish(id: string): Promise<void> {
    const items = this.jobs.get(id)!.items;
    const successful = items.filter(item => item.status === 'ready' || item.status === 'completed').length;
    await this.patch(id, { stage: successful === items.length ? 'completed' : successful ? 'partial' : 'failed' });
  }
  async export(payload: unknown): Promise<ApiResponse<ShortsJob>> {
    const input = parseShortsAction(payload, 'resultProjectIds');
    if (!input) return fail('INVALID_INPUT', 'Choose distinct created result projects.');
    await this.load();
    const parent = this.jobs.get(input.jobId);
    if (!parent) return fail('JOB_NOT_FOUND', 'The shorts run was not found.');
    const items = parent.items.filter(item => item.resultProjectId && input.ids.includes(item.resultProjectId));
    if (this.active.has(parent.id) || items.length !== input.ids.length) return fail('INVALID_INPUT', 'Choose result projects belonging to this settled run.');
    const job: ShortsJob = { ...this.fresh(parent.sourceProjectId, parent.sourceAssetId, 'exporting'), parentJobId: parent.id,
      items: items.map(item => ({ candidateId: item.candidateId, resultProjectId: item.resultProjectId!, status: 'exporting' })), ...(parent.recipes ? { recipes: parent.recipes } : {}) };
    await this.save(job);
    this.launch(job, async signal => {
      for (const item of job.items) {
        if (signal.aborted) break;
        let exportId: string | undefined;
        try {
          const response = await this.deps.exports.startExportJob({ projectId: item.resultProjectId!, width: 1080, height: 1920, frameRate: 30 });
          if (!response.ok) {
            await this.item(job.id, item.candidateId, { status: 'failed', error: response.error.message });
            continue;
          }
          exportId = response.value.id;
          await this.item(job.id, item.candidateId, { exportJobId: exportId });
          for (;;) {
            if (signal.aborted) await this.deps.exports.cancelExportJob({ jobId: exportId });
            const result = await this.deps.exports.getExportJob({ jobId: exportId });
            if (!result.ok) throw new Error('Export missing.');
            if (this.deps.exports.isSettled(exportId)) {
              await this.item(job.id, item.candidateId, { status: result.value.state.kind === 'completed' ? 'completed' : result.value.state.kind === 'cancelled' ? 'cancelled' : 'failed',
                ...(result.value.state.kind === 'failed' ? { error: 'The local export failed. Inspect its export job for details.' } : {}) });
              break;
            }
            await this.delay();
          }
        } catch {
          await this.item(job.id, item.candidateId, { status: signal.aborted ? 'cancelled' : 'failed', error: 'The local export could not be completed.' });
        } finally {
          if (exportId && !this.deps.exports.isSettled(exportId)) {
            await this.deps.exports.cancelExportJob({ jobId: exportId });
            while (!this.deps.exports.isSettled(exportId)) await this.delay();
          }
        }
      }
      if (signal.aborted) {
        for (const item of this.jobs.get(job.id)!.items) if (item.status === 'exporting') await this.item(job.id, item.candidateId, { status: 'cancelled' });
      } else await this.finish(job.id);
    });
    return ok(job);
  }
  async shutdown(): Promise<void> {
    for (const run of this.active.values()) if (!run.settling) run.controller.abort();
    await Promise.all([...this.active.values()].map(run => run.promise));
    await Promise.all([...this.writes.values()]);
  }
}
