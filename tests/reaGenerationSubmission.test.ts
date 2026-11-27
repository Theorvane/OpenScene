import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MinimaxPaygVideoTransport } from '../src/main/minimaxVideoTransport';
import { MinimaxVideoAdapter } from '../src/main/minimaxVideoAdapter';
import { ReaGenerationJobStore } from '../src/main/reaGenerationJobStore';
import { captureGenerationSourceIdentity, ReaGenerationSubmission } from '../src/main/reaGenerationSubmission';
import type { ReaGenerationPlan } from '../src/shared/reaGeneration';
import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';
import { runReaProcess } from '../src/main/reaVideoAnalysisProcess';
import { ProjectStore } from '../src/main/projectStore';
import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { OfflineReaGenerationRunner, ReaGenerationRunner } from '../src/main/reaGenerationRunner';
import type { ReaGenerationResultService } from '../src/main/reaGenerationResultService';
vi.mock('node:https', () => ({ request: vi.fn(() => { throw new Error('EXTERNAL_NETWORK_FORBIDDEN'); }) }));
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function directory() { const d = await mkdtemp(join(tmpdir(), 'rea-submit-')); dirs.push(d); return d; }
function plan(): ReaGenerationPlan { return { version: 1, projectId: 'p', sourceAssetId: 'source', sourceEpoch: 'e', reviewVersion: 1, shotId: 's', sourceStartMs: 0, sourceEndMs: 4000, prompt: 'Boat',
  provider: 'minimax-video-payg', baseUrl: 'https://api.minimax.io', model: 'MiniMax-H3', resolution: '768P', generateAudio: false, durationSeconds: 4, ratio: '16:9', referenceImage: null,
  estimate: { currency: 'USD', outputMicroUsdPerSecond: 80000, totalMicroUsd: 320000, budgetMicroUsd: 320000, pricedAt: '2026-11-27', billingCapGuaranteed: false }, manifest: { prompt: true, firstFrame: false, sourceVideo: false, sourceAudio: false } }; }
describe('production-disabled provider boundary', () => {
  it('blocks before credential read or exchange and separately blocks adapter calls', async () => {
    const credential = vi.fn(async () => 'fake-video-key'), exchange = vi.fn(async () => ({ status: 200, body: '{"task_id":"remote"}' }));
    const transport = new MinimaxPaygVideoTransport(() => false, credential, exchange);
    const poison = new Proxy({}, { get: () => { throw new Error('payload read'); } });
    await expect(transport.request(poison as Parameters<typeof transport.request>[0])).rejects.toThrow('PAID_EXECUTION_DISABLED');
    const adapter = new MinimaxVideoAdapter(transport);
    await expect(adapter.submit(plan())).rejects.toThrow('PAID_EXECUTION_DISABLED');
    await expect(adapter.query('remote', 4)).rejects.toThrow('PAID_EXECUTION_DISABLED');
    await expect(adapter.cancelQueued('remote')).rejects.toThrow('PAID_EXECUTION_DISABLED');
    expect(credential).not.toHaveBeenCalled(); expect(exchange).not.toHaveBeenCalled();
  });
  it('builds exact fixed-host fake-key HTTP requests without redirects or alternate endpoints', async () => {
    const credential = vi.fn(async () => 'fake-video-key'), exchange = vi.fn(async () => ({ status: 200, body: '{}' }));
    // Only the injected exchange executes; no actual HTTP permission is implied by this fixture.
    const transport = new MinimaxPaygVideoTransport(() => true, credential, exchange), signal = new AbortController().signal;
    for (const [method, path] of [['POST', '/v2/video_generation'], ['GET', '/v2/query/video_generation/remote'], ['DELETE', '/v2/video_generation/remote']] as const) {
      await transport.request({ method, path, signal, ...(method === 'POST' ? { body: '{}' } : {}) });
    }
    expect(exchange).toHaveBeenCalledTimes(3);
    for (const [input] of exchange.mock.calls as unknown as [{ url: URL; headers: Record<string, string> }][]) {
      expect(input.url.origin).toBe('https://api.minimax.io'); expect(input.headers.Authorization).toBe('Bearer fake-video-key');
    }
    const reads = credential.mock.calls.length;
    for (const path of ['https://evil.example/v2/video_generation', '/v2/video_generation/../secrets', '//evil.example', '/v2/query/video_generation/foreign?key=x']) await expect(transport.request({ method: 'GET', path, signal })).rejects.toThrow();
    expect(credential).toHaveBeenCalledTimes(reads); expect(exchange).toHaveBeenCalledTimes(3);
  });
  it('does not consume approval or resolve source/image when submit permission is false', async () => {
    const d = await directory(), post = vi.fn(async () => ({ status: 200, body: '{"task_id":"remote"}' })), adapter = new MinimaxVideoAdapter({ kind: 'offline-fixture', request: post });
    const jobs = new ReaGenerationJobStore(d, adapter), p = { ...plan(), sourceIdentity: 'a'.repeat(64) }, prepared = await jobs.prepare(p);
    const source = vi.fn(async () => 'a'.repeat(64)), image = vi.fn(async () => undefined), service = new ReaGenerationSubmission(() => false, jobs, source, image);
    await expect(service.submit({ id: prepared.receipt.id, approval: prepared.approval, plan: p })).rejects.toThrow('PAID_EXECUTION_DISABLED');
    expect((await jobs.get(prepared.receipt.id, 'p')).state).toBe('awaiting-approval'); expect(source).not.toHaveBeenCalled(); expect(image).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  });
  it('preserves a persisted remote task without observing or reading a key while permission is false', async () => {
    const d = await directory(), key = vi.fn(async () => 'fake-key'), exchange = vi.fn(async () => ({ status: 200, body: '{}' }));
    const adapter = new MinimaxVideoAdapter(new MinimaxPaygVideoTransport(() => false, key, exchange));
    const jobs = new ReaGenerationJobStore(d, adapter), prepared = await jobs.prepare(plan());
    const data = JSON.parse(await readFile(join(d, 'jobs.json'), 'utf8')); data[0].state = 'queued'; data[0].taskId = 'existing-remote'; await writeFile(join(d, 'jobs.json'), JSON.stringify(data));
    const restored = new ReaGenerationJobStore(d, adapter), results = new Proxy({}, { get: () => { throw new Error('result accessed'); } }) as ReaGenerationResultService;
    const runner = new ReaGenerationRunner(restored, adapter, results);
    expect((await runner.observe(prepared.receipt.id, 'p')).receipt).toMatchObject({ state: 'queued', taskId: 'existing-remote' });
    expect(key).not.toHaveBeenCalled(); expect(exchange).not.toHaveBeenCalled(); await runner.dispose();
  });
  it('bounds result collection separately and persists its limit across restart', async () => {
    const d = await directory(), post = vi.fn(async () => ({ status: 200, body: '{"task_id":"remote"}' }));
    const adapter = new MinimaxVideoAdapter({ kind: 'offline-fixture', request: post }), jobs = new ReaGenerationJobStore(d, adapter, () => 1000);
    const a = await jobs.prepare(plan()), data = JSON.parse(await readFile(join(d, 'jobs.json'), 'utf8'));
    data[0].state = 'remote-succeeded'; data[0].taskId = 'remote'; await writeFile(join(d, 'jobs.json'), JSON.stringify(data));
    const recovered = new ReaGenerationJobStore(d, adapter, () => 1000);
    for (let i = 0; i < 3; i++) await recovered.claimResultCollection(a.receipt.id, 'p');
    await expect(new ReaGenerationJobStore(d, adapter, () => 1000).claimResultCollection(a.receipt.id, 'p')).rejects.toThrow('COLLECTION_BOUND');
    expect(post).not.toHaveBeenCalled();
    expect(() => jobs.prepare({ ...plan(), prompt: 'x'.repeat(7001) })).toThrow();
  });
  it('does not start a result GET after shutdown while a status GET is settling', async () => {
    const d = await directory(); let finish!: (r: { status: number; body: string }) => void;
    const request = vi.fn(async (r: { method: string }) => r.method === 'POST' ? { status: 200, body: '{"task_id":"remote"}' } : new Promise<{ status: number; body: string }>(resolve => { finish = resolve; }));
    const adapter = new MinimaxVideoAdapter({ kind: 'offline-fixture', request }), jobs = new ReaGenerationJobStore(d, adapter), p = plan(), a = await jobs.prepare(p);
    await jobs.submit(a.receipt.id, a.approval, p);
    const results = { get: vi.fn(() => null), receive: vi.fn(), retire: vi.fn() } as unknown as ReaGenerationResultService;
    const runner = new OfflineReaGenerationRunner(jobs, adapter, results), observing = runner.observe(a.receipt.id, 'p');
    const rejected = expect(observing).rejects.toThrow('RESULT_RETIRED');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2)); const closing = runner.dispose();
    finish({ status: 200, body: JSON.stringify({ task: { id: 'remote', model: 'MiniMax-H3', status: 'succeeded', task_type: 'generation', modality: 'video', resolution: '768P', duration: 4 } }) });
    await rejected; await closing; expect(request).toHaveBeenCalledTimes(2); expect(results.receive).not.toHaveBeenCalled();
  });
  it('rejects changed source, image and prompt before POST with the exact approved plan', async () => {
    const d = await directory(), post = vi.fn(async () => ({ status: 200, body: '{"task_id":"remote"}' })), adapter = new MinimaxVideoAdapter({ kind: 'offline-fixture', request: post });
    const jobs = new ReaGenerationJobStore(d, adapter), p = { ...plan(), sourceIdentity: 'a'.repeat(64) }, prepared = await jobs.prepare(p);
    const source = vi.fn(async () => 'b'.repeat(64)), image = vi.fn(async () => undefined), service = new ReaGenerationSubmission(() => true, jobs, source, image);
    await expect(service.submit({ id: prepared.receipt.id, approval: prepared.approval, plan: p })).rejects.toThrow('SOURCE_CHANGED');
    source.mockResolvedValue('a'.repeat(64));
    await expect(service.submit({ id: prepared.receipt.id, approval: prepared.approval, plan: { ...p, prompt: 'Changed' } })).rejects.toThrow('SOURCE_CHANGED');
    const i2v: ReaGenerationPlan = { ...p, ratio: 'adaptive', referenceImage: { assetId: 'image', sha256: 'c'.repeat(64), byteLength: 1, mimeType: 'image/png' }, manifest: { ...p.manifest, firstFrame: true } };
    const a = await jobs.prepare(i2v);
    await expect(service.submit({ id: a.receipt.id, approval: a.approval, plan: i2v })).rejects.toThrow('REFERENCE_CHANGED');
    expect(post).not.toHaveBeenCalled(); expect((await jobs.get(prepared.receipt.id, 'p')).state).toBe('awaiting-approval');
  });
  it('hashes actual source bytes and validates source range through local probe', async ctx => {
    const ffmpeg = await discoverFfmpeg(); if (ffmpeg.kind === 'unavailable') { ctx.skip(); return; }
    const d = await directory(), path = join(d, 'source.mp4');
    await runReaProcess(ffmpeg.executablePath, ['-nostdin', '-hide_banner', '-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12', '-t', '4', '-an', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', path], new AbortController().signal, 15000);
    const projects = new ProjectStore(join(d, 'projects')), project = await projects.create({ name: 'Source identity' }), assets = new AssetLibraryStore(join(d, 'projects'), projects);
    const asset = await assets.import({ projectId: project.id, sourcePath: path, displayName: 'Source', kind: 'video', mimeType: 'video/mp4' });
    const p = { ...plan(), projectId: project.id, sourceAssetId: asset.id };
    const identity = await captureGenerationSourceIdentity(assets, ffmpeg.executablePath, p);
    expect(await captureGenerationSourceIdentity(assets, ffmpeg.executablePath, p)).toBe(identity);
    await expect(captureGenerationSourceIdentity(assets, ffmpeg.executablePath, { ...p, sourceEndMs: 5000 })).rejects.toThrow();
    const playback = (await assets.getPlaybackSource(project.id, asset.id))!;
    const bytes = await readFile(playback.filePath); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; await writeFile(playback.filePath, bytes);
    expect(await captureGenerationSourceIdentity(assets, ffmpeg.executablePath, p)).not.toBe(identity);
  });
});
