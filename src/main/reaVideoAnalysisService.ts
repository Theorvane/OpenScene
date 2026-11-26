import { randomUUID } from 'node:crypto';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { discoverFfmpeg } from './ffmpegDiscovery';
import { ReaProcessError, runReaProcess } from './reaVideoAnalysisProcess';
import { inspectReaPython } from './reaVideoAnalysisRuntime';
import { measuredReaPlan, parseReaAnalysisInput, reaPlanImportOperations, reaVideoMarkdown, REA_ANALYSIS_LIMITS, type ReaAnalysisInput, type ReaAnalysisJob, type ReaAnalysisRuntime } from '../shared/reaVideoAnalysis';

type Source = { readonly path: string; readonly kind: string };
export class ReaVideoAnalysisService {
  private readonly jobs = new Map<string, ReaAnalysisJob>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly active = new Set<Promise<void>>();
  private readonly sources = new Map<string, { path: string; size: number; mtimeMs: number }>();
  private pythonInspection: ReturnType<typeof inspectReaPython> | undefined;
  constructor(private readonly resolveSource: (input: ReaAnalysisInput) => Promise<Source>, private readonly discover = discoverFfmpeg) {}
  private async tools(): Promise<{ ffmpeg: string; ffprobe: string }> {
    const result = await this.discover();
    if (result.kind === 'unavailable') throw new ReaProcessError('runtime-unavailable');
    const ffprobe = join(dirname(result.executablePath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    try { await access(ffprobe, process.platform === 'win32' ? constants.F_OK : constants.X_OK); }
    catch { throw new ReaProcessError('runtime-unavailable'); }
    return { ffmpeg: result.executablePath, ffprobe };
  }
  async runtime(): Promise<ReaAnalysisRuntime> {
    const upstreamPython = 'not-used-requires-python-3.10-and-separate-dependency-review' as const;
    const python = await (this.pythonInspection ??= inspectReaPython());
    try { await this.tools(); return { available: true, upstreamPython, python }; }
    catch { return { available: false, reason: 'Configure local FFmpeg with a sibling ffprobe executable. Nothing is downloaded.', upstreamPython, python }; }
  }
  start(raw: unknown): ReaAnalysisJob {
    const input = parseReaAnalysisInput(raw);
    if (this.controllers.size) throw new Error('Wait for the current local analysis to finish.');
    while (this.jobs.size >= REA_ANALYSIS_LIMITS.jobs) { const oldest = this.jobs.keys().next().value!; this.jobs.delete(oldest); this.sources.delete(oldest); }
    const id = randomUUID(), controller = new AbortController();
    const job: ReaAnalysisJob = { ...input, id, status: 'running', cleanupComplete: false };
    this.jobs.set(id, job); this.controllers.set(id, controller);
    const task = this.analyze(job, controller.signal);
    this.active.add(task); void task.finally(() => this.active.delete(task));
    return job;
  }
  get(id: string): ReaAnalysisJob {
    const job = this.jobs.get(id); if (!job) throw new Error('Unknown analysis job.');
    return structuredClone(job);
  }
  cancel(id: string): ReaAnalysisJob {
    const job = this.get(id), controller = this.controllers.get(id);
    if (controller) controller.abort();
    else if (job.status === 'review') this.jobs.set(id, { id: job.id, projectId: job.projectId, assetId: job.assetId, status: 'cancelled', cleanupComplete: true });
    return this.get(id);
  }
  async prepareImport(raw: unknown): Promise<readonly unknown[]> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid import.');
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).some(key => !['projectId', 'assetId', 'jobId', 'shotIds', 'trackId', 'prefix', 'atMs'].includes(key))) throw new Error('Invalid import fields.');
    const scope = parseReaAnalysisInput({ projectId: value.projectId, assetId: value.assetId });
    if (typeof value.jobId !== 'string' || typeof value.trackId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.trackId) || typeof value.prefix !== 'string' || typeof value.atMs !== 'number' || !Array.isArray(value.shotIds) || value.shotIds.length > 60 || !value.shotIds.every(id => typeof id === 'string')) throw new Error('Invalid import selection.');
    const job = this.get(value.jobId), measured = this.sources.get(job.id);
    if (job.status !== 'review' || !job.plan || !measured || job.projectId !== scope.projectId || job.assetId !== scope.assetId) throw new Error('Stale analysis.');
    const source = await this.resolveSource(scope), current = await stat(source.path);
    if (source.kind !== 'video' || source.path !== measured.path || current.size !== measured.size || current.mtimeMs !== measured.mtimeMs || this.get(job.id).status !== 'review') throw new Error('Source changed or analysis cancelled.');
    return reaPlanImportOperations(job.plan, value.shotIds, value.trackId, value.prefix, value.atMs);
  }
  async dispose(): Promise<void> { for (const controller of this.controllers.values()) controller.abort(); await Promise.allSettled(this.active); }
  private async analyze(job: ReaAnalysisJob, signal: AbortSignal): Promise<void> {
    try {
      const tools = await this.tools();
      const source = await this.resolveSource({ projectId: job.projectId, assetId: job.assetId });
      if (source.kind !== 'video' || !isAbsolute(source.path) || !(await stat(source.path)).isFile()) throw new ReaProcessError('invalid-media');
      const identity = await stat(source.path);
      if (identity.size > 2_147_483_648) throw new ReaProcessError('resource-limit');
      this.sources.set(job.id, { path: source.path, size: identity.size, mtimeMs: identity.mtimeMs });
      const probe = await runReaProcess(tools.ffprobe, ['-v', 'error', '-max_alloc', '67108864', '-format_whitelist', 'mov,matroska,webm,avi,mpegts,flv,ogg', '-protocol_whitelist', 'file', '-select_streams', 'v:0', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', source.path], signal, 15_000);
      const metadata = JSON.parse(probe.stdout) as { format?: { duration?: string }; streams?: { codec_type: string; width: number; height: number }[] };
      const video = metadata.streams?.[0];
      const durationMs = Math.round(Number(metadata.format?.duration) * 1000);
      if (!video || video.codec_type !== 'video' || !video.width || !video.height) throw new ReaProcessError('invalid-media');
      if (video.width > 3840 || video.height > 3840 || video.width * video.height > 3840 * 2160) throw new ReaProcessError('resource-limit');
      try { measuredReaPlan({ projectId: job.projectId, assetId: job.assetId }, durationMs, []); } catch { throw new ReaProcessError('resource-limit'); }
      const measured = await runReaProcess(tools.ffmpeg, ['-nostdin', '-hide_banner', '-v', 'info', '-max_alloc', '67108864', '-threads', '1', '-filter_threads', '1', '-format_whitelist', 'mov,matroska,webm,avi,mpegts,flv,ogg', '-protocol_whitelist', 'file', '-i', source.path, '-t', String(durationMs / 1000), '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', "scale=320:-2,select='gt(scene,0.35)',showinfo", '-f', 'null', '-'], signal);
      const cuts = [...measured.stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)].map(match => Math.round(Number(match[1]) * 1000));
      const after = await stat(source.path);
      if (after.size !== identity.size || after.mtimeMs !== identity.mtimeMs) throw new ReaProcessError('invalid-media');
      let plan;
      try { plan = measuredReaPlan({ projectId: job.projectId, assetId: job.assetId }, durationMs, cuts); } catch { throw new ReaProcessError('resource-limit'); }
      if (signal.aborted) throw new ReaProcessError('cancelled');
      this.jobs.set(job.id, { ...job, status: 'review', cleanupComplete: true, plan, videoMd: reaVideoMarkdown(plan) });
    } catch (error) {
      const kind = signal.aborted ? 'cancelled' : error instanceof ReaProcessError ? error.kind : 'invalid-media';
      this.jobs.set(job.id, { ...job, status: kind === 'cancelled' ? 'cancelled' : 'failed', cleanupComplete: true, ...(kind === 'cancelled' ? {} : { error: kind }) });
    } finally { this.controllers.delete(job.id); }
  }
}
