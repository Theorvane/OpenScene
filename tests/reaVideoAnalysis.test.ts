import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';
import { runReaProcess } from '../src/main/reaVideoAnalysisProcess';
import { ReaVideoAnalysisService } from '../src/main/reaVideoAnalysisService';
import { registerReaAnalysisIpc } from '../src/main/reaVideoAnalysisIpc';
import { measuredReaPlan, parseReaAnalysisInput, reaPlanImportOperations, reaVideoMarkdown, REA_ANALYSIS_LIMITS } from '../src/shared/reaVideoAnalysis';
import { applyEditorOperations } from '../src/shared/editorOperations';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { parseTimelineDocument } from '../src/shared/timelineDocumentValidators';
import type { MediaAsset } from '../src/shared/timelineTypes';
import { createTimelineHistory, pushTimelineHistory, undoTimelineHistory } from '../src/renderer/src/editor/editorTimelineHistory';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const input = { projectId: 'project', assetId: 'source' };
async function settled(service: ReaVideoAnalysisService, id: string) {
  for (let index = 0; index < 1000; index++) {
    const job = service.get(id); if (job.cleanupComplete) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Analysis did not settle.');
}
describe('measured local shot plans', () => {
  it('bounds and labels evidence, never invents semantics or generation', () => {
    const plan = measuredReaPlan(input, 3000, [2000, 1000, 1000, -1, NaN, 4000]);
    expect(plan.shots.map(shot => [shot.sourceStartMs, shot.sourceEndMs])).toEqual([[0, 1000], [1000, 2000], [2000, 3000]]);
    expect(plan.paidExecutionAllowed).toBe(false);
    expect(reaVideoMarkdown(plan)).toContain('not a complete upstream');
    expect(reaVideoMarkdown(plan)).toContain('No models called; no video generated');
    expect(() => measuredReaPlan(input, REA_ANALYSIS_LIMITS.durationMs + 1, [])).toThrow();
    expect(() => measuredReaPlan(input, 10000, Array.from({ length: 61 }, (_, i) => i + 1))).toThrow();
    expect(() => parseReaAnalysisInput({ ...input, sourcePath: '/private/source' })).toThrow();
    expect(() => parseReaAnalysisInput({ ...input, assetId: '../escape' })).toThrow();
  });
  it('roundtrips reviewed original ranges through the existing atomic editor without saving', () => {
    const plan = measuredReaPlan(input, 3000, [1000, 2000]);
    const timeline = createInitialTimeline(), before = JSON.stringify(timeline);
    const asset: MediaAsset = { id: 'source', kind: 'video', displayName: 'Original', projectRelativePath: 'assets/source.mp4', mimeType: 'video/mp4', byteLength: 10, metadata: { durationMs: 3000 }, createdAt: '2026-11-26T00:00:00Z', updatedAt: '2026-11-26T00:00:00Z' };
    const track = timeline.tracks.find(track => track.kind === 'video')!;
    const operations = reaPlanImportOperations(plan, ['shot-1', 'shot-3'], track.id, 'review', 500);
    const result = applyEditorOperations(timeline, operations, [asset]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(parseTimelineDocument(JSON.parse(JSON.stringify(result.timeline)))).not.toBeNull();
    expect(result.timeline.tracks.find(t => t.id === track.id)!.clips.map(clip => [clip.timelineStartMs, clip.sourceStartMs, clip.sourceEndMs])).toEqual([[500, 0, 1000], [1500, 2000, 3000]]);
    expect(JSON.stringify(timeline)).toBe(before);
    const history = pushTimelineHistory(createTimelineHistory(timeline), result.timeline);
    expect(history.past).toHaveLength(1);
    expect(history.present).not.toEqual(timeline);
    expect(undoTimelineHistory(history)?.present).toEqual(timeline);
    expect(applyEditorOperations(timeline, reaPlanImportOperations(plan, ['shot-1'], 'missing', 'invalid', 0), [asset]).success).toBe(false);
  });
  it('preserves exact licensed upstream audit resources', async () => {
    const manifest = JSON.parse(await readFile('resources/rea-video/UPSTREAM.json', 'utf8')) as { commit: string; files: Record<string, { sha256: string; bytes: number }> };
    expect(manifest.commit).toBe('c11f1bd8fd3edd26a40e8f45be828be685417700');
    for (const [name, expected] of Object.entries(manifest.files)) {
      const data = await readFile(join('resources/rea-video', name));
      expect(data.length).toBe(expected.bytes); expect(createHash('sha256').update(data).digest('hex')).toBe(expected.sha256);
    }
  });
  it('reports unavailable runtime without accessing a source; sanitizes IPC failures', async () => {
    const service = new ReaVideoAnalysisService(async () => { throw new Error('/secret/path'); }, async () => ({ kind: 'unavailable', reason: '/secret/runtime' }));
    expect((await service.runtime()).available).toBe(false);
    const job = await settled(service, service.start(input).id);
    expect(job.error).toBe('runtime-unavailable'); expect(JSON.stringify(job)).not.toContain('/secret');
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
    registerReaAnalysisIpc(service, (channel, handler) => handlers.set(channel, handler));
    expect(await handlers.get('rea-analysis:get')!({ jobId: job.id, path: '/secret' })).toMatchObject({ ok: false });
    await service.dispose();
  });
  it('kills and settles cancelled, timed out and excessive-output children', async () => {
    const controller = new AbortController();
    const child = runReaProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], controller.signal);
    controller.abort(); await expect(child).rejects.toMatchObject({ kind: 'cancelled' });
    await expect(runReaProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], new AbortController().signal, 30)).rejects.toMatchObject({ kind: 'resource-limit' });
    await expect(runReaProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(300000))'], new AbortController().signal)).rejects.toMatchObject({ kind: 'resource-limit' });
    await expect(runReaProcess('/not/an/executable', [], new AbortController().signal)).rejects.toMatchObject({ kind: 'runtime-unavailable' });
  });
  it('measures a real tiny two-color fixture, rejects corrupt media and settles cancellation', async () => {
    const ffmpeg = await discoverFfmpeg();
    if (ffmpeg.kind === 'unavailable') { console.info('Real FFmpeg fixture unavailable on this host.'); return; }
    const root = await mkdtemp(join(tmpdir(), 'rea-analysis-')); roots.push(root);
    const source = join(root, 'source ; $(unsafe).mp4');
    await runReaProcess(ffmpeg.executablePath, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=160x90:r=10:d=1', '-f', 'lavfi', '-i', 'color=white:s=160x90:r=10:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'mpeg4', source], new AbortController().signal);
    const original = await readFile(source);
    const service = new ReaVideoAnalysisService(async () => ({ path: source, kind: 'video' }));
    const running = service.start(input);
    expect(() => service.start(input)).toThrow();
    const job = await settled(service, running.id);
    expect(job.status).toBe('review'); expect(job.plan?.durationMs).toBe(2000);
    expect(job.plan?.shots.map(shot => shot.sourceStartMs)).toEqual([0, 1000]);
    const request = { ...input, jobId: job.id, shotIds: ['shot-1'], trackId: 'video', prefix: 'reviewed', atMs: 0 };
    expect(await service.prepareImport(request)).toEqual([expect.objectContaining({ sourceStartMs: 0, sourceEndMs: 1000, action: 'clip.add' })]);
    await expect(service.prepareImport({ ...request, projectId: 'other' })).rejects.toThrow();
    await expect(service.prepareImport({ ...request, shotIds: ['invented'] })).rejects.toThrow();
    await expect(service.prepareImport({ ...request, operations: [] })).rejects.toThrow();
    expect(JSON.stringify(job)).not.toContain(root); expect(await readFile(source)).toEqual(original);
    service.cancel(job.id); await expect(service.prepareImport(request)).rejects.toThrow();
    const cancelled = service.start(input); service.cancel(cancelled.id);
    expect((await settled(service, cancelled.id)).status).toBe('cancelled');
    await service.dispose();
    const stale = new ReaVideoAnalysisService(async () => ({ path: source, kind: 'video' }));
    const staleJob = await settled(stale, stale.start(input).id);
    await writeFile(source, 'corrupt');
    await expect(stale.prepareImport({ ...request, jobId: staleJob.id })).rejects.toThrow(); await stale.dispose();
    const corrupt = new ReaVideoAnalysisService(async () => ({ path: source, kind: 'video' }));
    expect((await settled(corrupt, corrupt.start(input).id)).error).toBe('invalid-media'); await corrupt.dispose();
  }, 20_000);
  it('refuses a remote playlist without opening its network URL', async () => {
    const ffmpeg = await discoverFfmpeg(); if (ffmpeg.kind === 'unavailable') return;
    const root = await mkdtemp(join(tmpdir(), 'rea-playlist-')); roots.push(root);
    let requests = 0;
    const server = createServer((_request, response) => { requests++; response.end('unexpected'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture server unavailable.');
    const path = join(root, 'source.m3u8');
    await writeFile(path, `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${address.port}/must-not-request.ts\n#EXT-X-ENDLIST\n`);
    const service = new ReaVideoAnalysisService(async () => ({ path, kind: 'video' }));
    try { expect((await settled(service, service.start(input).id)).status).toBe('failed'); expect(requests).toBe(0); }
    finally { await service.dispose(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
