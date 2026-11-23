import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortsService } from '../src/main/shortsService';
import { ProjectStore } from '../src/main/projectStore';
import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import type { ExportIpcService } from '../src/main/exportIpcService';
import type { TranscriptionService } from '../src/main/transcriptionService';
import type { ShortsJob } from '../src/shared/shortsTypes';
import type { ShortsSelectionProvider } from '../src/shared/shortsCandidateSelection';
import type { ApiResponse } from '../src/shared/models';
import { parseShortsStart } from '../src/shared/shortsValidators';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function value<T>(response: ApiResponse<T>): T { if (!response.ok) throw new Error(response.error.message); return response.value; }
const cues = [
  { id: 'a', text: 'First complete fixture idea.', startMs: 1000, endMs: 5000 },
  { id: 'b', text: 'Second separate fixture idea.', startMs: 7000, endMs: 11000 }
];
const provider: ShortsSelectionProvider = async () => ({ candidates: cues.map(cue => ({ firstEvidenceId: cue.id, lastEvidenceId: cue.id, reason: cue.text,
  evidenceIds: [cue.id], context: { completeThought: true, notes: 'Complete fixed fixture passage.' } })) });

async function setup(options: { provider?: ShortsSelectionProvider; transcript?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'shorts-service-')); roots.push(root);
  const projects = new ProjectStore(join(root, 'projects'));
  const assets = new AssetLibraryStore(join(root, 'projects'), projects);
  const project = await projects.create({ name: 'Original' });
  const sourcePath = join(root, 'source.mp4'); await writeFile(sourcePath, 'synthetic import bytes, not decodable video');
  const imported = await assets.import({ projectId: project.id, sourcePath, displayName: 'Source', kind: 'video', mimeType: 'video/mp4' });
  const asset = await assets.updateMetadata({ projectId: project.id, assetId: imported.id, durationMs: 12000, width: 640, height: 360 });
  if (options.transcript !== false) await projects.saveAiProjectDocument(project.id, { ...project.ai, transcriptionDraft: {
    id: 'draft', sourceAssetId: asset.id, cues, language: 'en', status: 'approved', engine: 'whisper.cpp', modelName: 'fixture', createdAt: new Date().toISOString()
  } });
  let exportCounter = 0;
  const exportStates = new Map<string, 'completed' | 'cancelled'>();
  const exports = {
    startExportJob: vi.fn(async (input: { projectId: string }) => {
      const id = `export-${++exportCounter}`; exportStates.set(id, 'completed');
      return { ok: true, value: { id, projectId: input.projectId, state: { kind: 'queued' } } };
    }),
    getExportJob: vi.fn(async (input: { jobId: string }) => ({ ok: true, value: { id: input.jobId, state: { kind: exportStates.get(input.jobId) } } })),
    isSettled: vi.fn(() => true), cancelExportJob: vi.fn(async () => ({ ok: true, value: { cancelled: true } }))
  };
  const transcription = {
    runtimeStatus: vi.fn(async () => ({ ready: true })),
    start: vi.fn(async () => ({ ok: true, value: { id: 'transcription-1' } })),
    get: vi.fn(() => ({ id: 'transcription-1', status: 'completed', progressPercent: 100, draft: { cues } })),
    isSettled: vi.fn(() => true), cancel: vi.fn()
  };
  const dependencies = { projects, assets, exports: exports as unknown as ExportIpcService, transcription: transcription as unknown as TranscriptionService,
    jobsDirectory: join(root, 'shorts-jobs'), providerFor: () => options.provider ?? provider, measureSource: async () => ({ durationMs: 12000, width: 640, height: 360 }), pollMs: 1 };
  const service = new ShortsService(dependencies);
  const request = { projectId: project.id, assetId: asset.id, modelId: 'fixture', minDurationMs: 1000, maxDurationMs: 12000 };
  return { root, sourcePath, projects, assets, project, asset, service, exports, transcription, dependencies, request };
}
async function settled(service: ShortsService, id: string): Promise<ShortsJob> {
  for (let n = 0; n < 1000; n++) {
    const job = value(await service.get({ jobId: id }));
    if (job.cleanupComplete) return job;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('Run did not settle.');
}

describe('local multi-shorts service', () => {
  it('uses measured evidence, approves isolated editable projects and exports on fresh runs', async () => {
    const s = await setup();
    const before = await s.projects.open(s.project.id);
    const selected = await settled(s.service, value(await s.service.start(s.request)).id);
    expect(selected).toMatchObject({ stage: 'review', selection: { status: 'insufficient-evidence' }, captions: cues });
    const ids = selected.selection!.candidates.map(item => item.id);
    expect(ids).toHaveLength(2);
    expect((await s.projects.list())).toHaveLength(1); // Selection is read-only.
    value(await s.service.materialize({ jobId: selected.id, candidateIds: ids }));
    const created = await settled(s.service, selected.id);
    expect(created.stage).toBe('completed');
    expect(created.items.every(item => item.status === 'ready')).toBe(true);
    for (const [index, item] of created.items.entries()) {
      const output = await s.projects.open(item.resultProjectId!);
      const clip = output!.timeline.tracks.flatMap(track => track.clips)[0]!;
      expect([clip.timelineStartMs, clip.sourceStartMs, clip.sourceEndMs]).toEqual([0, cues[index]!.startMs, cues[index]!.endMs]);
      expect(output!.timeline.titles?.map(title => [title.text, title.timelineStartMs, title.timelineEndMs])).toEqual([[cues[index]!.text, 0, 4000]]);
      expect(output!.assets[0]!.id).not.toBe(s.asset.id);
    }
    expect(await s.projects.open(s.project.id)).toEqual(before);
    expect(await readFile(s.sourcePath, 'utf8')).toBe('synthetic import bytes, not decodable video');
    const resultIds = created.items.map(item => item.resultProjectId!);
    const exportRun = value(await s.service.export({ jobId: created.id, resultProjectIds: resultIds }));
    expect(exportRun.id).not.toBe(created.id);
    const exported = await settled(s.service, exportRun.id);
    expect(exported.items.map(item => item.exportJobId)).toEqual(['export-1', 'export-2']);
    expect(s.exports.startExportJob.mock.calls[0]![0]).toMatchObject({ width: 1080, height: 1920, frameRate: 30 });
    const retry = await settled(s.service, value(await s.service.export({ jobId: exported.id, resultProjectIds: [resultIds[0]!] })).id);
    expect(retry.items[0]!.exportJobId).toBe('export-3');
    expect(value(await s.service.get({ jobId: exported.id })).items).toEqual(exported.items);
    const reopened = new ShortsService(s.dependencies);
    expect(value(await reopened.list({ projectId: s.project.id }))).toHaveLength(3);
  });
  it('automatically starts local transcription when missing and reports configuration separately', async () => {
    const s = await setup({ transcript: false });
    expect((await settled(s.service, value(await s.service.start(s.request)).id)).stage).toBe('review');
    expect(s.transcription.start).toHaveBeenCalledWith({ projectId: s.project.id, assetId: s.asset.id, language: 'auto' });
    s.transcription.runtimeStatus.mockResolvedValue({ ready: false });
    expect(await settled(s.service, value(await s.service.start(s.request)).id)).toMatchObject({ stage: 'failed', errorCode: 'transcription_not_configured' });
  });
  it('distinguishes insufficient evidence, provider failure and invalid input', async () => {
    const empty = await setup({ provider: async () => ({ candidates: [] }) });
    expect(await settled(empty.service, value(await empty.service.start(empty.request)).id)).toMatchObject({ stage: 'review', selection: { status: 'insufficient-evidence', candidates: [] } });
    const bad = await setup({ provider: async () => { throw new Error('provider secret and /private/path must stay private'); } });
    const failed = await settled(bad.service, value(await bad.service.start(bad.request)).id);
    expect(failed).toMatchObject({ stage: 'failed', errorCode: 'provider_failed' });
    expect(JSON.stringify(failed)).not.toContain('/private/path');
    expect(await bad.service.start({ ...bad.request, sourcePath: '/tmp/x' })).toMatchObject({ ok: false });
    expect(parseShortsStart({ ...bad.request, minDurationMs: NaN })).toBeNull();
  });
  it('keeps cancellation accepted separate from actual provider settlement', async () => {
    let release!: (value: unknown) => void;
    let started = false;
    const s = await setup({ provider: async () => { started = true; return new Promise(resolve => { release = resolve; }); } });
    const job = value(await s.service.start(s.request));
    while (!started) await new Promise(resolve => setTimeout(resolve, 1));
    expect(await s.service.cancel({ jobId: job.id })).toEqual({ ok: true, value: { accepted: true } });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(value(await s.service.get({ jobId: job.id }))).toMatchObject({ stage: 'cancelling', cleanupComplete: false });
    release({ candidates: [] });
    expect(await settled(s.service, job.id)).toMatchObject({ stage: 'cancelled', cleanupComplete: true });
    expect(await s.projects.list()).toHaveLength(1);
  });
  it('keeps completed results through partial materialization and deletes failed projects', async () => {
    const s = await setup();
    const job = await settled(s.service, value(await s.service.start(s.request)).id);
    const actual = s.projects.saveTimeline.bind(s.projects);
    vi.spyOn(s.projects, 'saveTimeline').mockImplementationOnce(actual).mockRejectedValueOnce(new Error('Disk failure'));
    value(await s.service.materialize({ jobId: job.id, candidateIds: job.selection!.candidates.map(item => item.id) }));
    const result = await settled(s.service, job.id);
    expect(result.stage).toBe('partial');
    expect(result.items.map(item => item.status)).toEqual(['ready', 'failed']);
    expect(await s.projects.list()).toHaveLength(2);
  });
  it('waits beyond cancelled export status until cleanup settles', async () => {
    const s = await setup();
    const selection = await settled(s.service, value(await s.service.start(s.request)).id);
    value(await s.service.materialize({ jobId: selection.id, candidateIds: [selection.selection!.candidates[0]!.id] }));
    const created = await settled(s.service, selection.id);
    let clean = false;
    s.exports.isSettled.mockImplementation(() => clean);
    s.exports.getExportJob.mockImplementation(async ({ jobId }) => ({ ok: true, value: { id: jobId, state: { kind: 'cancelled' } } }));
    const exportRun = value(await s.service.export({ jobId: created.id, resultProjectIds: [created.items[0]!.resultProjectId!] }));
    while (!s.exports.startExportJob.mock.calls.length) await new Promise(resolve => setTimeout(resolve, 1));
    value(await s.service.cancel({ jobId: exportRun.id }));
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(value(await s.service.get({ jobId: exportRun.id }))).toMatchObject({ stage: 'cancelling', cleanupComplete: false });
    clean = true;
    expect(await settled(s.service, exportRun.id)).toMatchObject({ stage: 'cancelled', cleanupComplete: true });
    expect(await s.projects.open(created.items[0]!.resultProjectId!)).not.toBeNull();
  });
  it('refuses changed media after review and cleans copied results', async () => {
    const s = await setup();
    const job = await settled(s.service, value(await s.service.start(s.request)).id);
    const source = await s.assets.getPlaybackSource(s.project.id, s.asset.id);
    await writeFile(source!.filePath, 'changed source after evidence review');
    value(await s.service.materialize({ jobId: job.id, candidateIds: [job.selection!.candidates[0]!.id] }));
    expect(await settled(s.service, job.id)).toMatchObject({ stage: 'failed', items: [{ status: 'failed' }] });
    expect(await s.projects.list()).toHaveLength(1);
  });
  it('cancels during a copy, waits for that copy, and removes only the incomplete project', async () => {
    const s = await setup();
    const job = await settled(s.service, value(await s.service.start(s.request)).id);
    let release!: () => void;
    let copying = false;
    const actual = s.assets.import.bind(s.assets);
    vi.spyOn(s.assets, 'import').mockImplementation(async input => {
      copying = true;
      await new Promise<void>(resolve => { release = resolve; });
      return actual(input);
    });
    value(await s.service.materialize({ jobId: job.id, candidateIds: job.selection!.candidates.map(item => item.id) }));
    while (!copying) await new Promise(resolve => setTimeout(resolve, 1));
    value(await s.service.cancel({ jobId: job.id }));
    expect(value(await s.service.get({ jobId: job.id }))).toMatchObject({ stage: 'cancelling', cleanupComplete: false });
    release();
    const cancelled = await settled(s.service, job.id);
    expect(cancelled.items.map(item => item.status)).toEqual(['cancelled', 'cancelled']);
    expect(await s.projects.list()).toHaveLength(1);
  });
  it('loads interrupted runs without resuming or claiming crash cleanup', async () => {
    const s = await setup();
    const job = await settled(s.service, value(await s.service.start(s.request)).id);
    await writeFile(join(s.root, 'shorts-jobs', `${job.id}.json`), JSON.stringify({ ...job, stage: 'exporting', cleanupComplete: false }));
    const restarted = new ShortsService(s.dependencies);
    expect(value(await restarted.get({ jobId: job.id }))).toMatchObject({ stage: 'failed', errorCode: 'interrupted', cleanupComplete: false });
    expect(s.exports.startExportJob).not.toHaveBeenCalled();
  });
});
