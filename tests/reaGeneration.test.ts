import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { MinimaxVideoAdapter, type OfflineVideoTransport } from '../src/main/minimaxVideoAdapter';
import { ReaGenerationJobStore } from '../src/main/reaGenerationJobStore';
import { REA_GENERATION_POLICY, type ReaGenerationPlan } from '../src/shared/reaGeneration';

const plan = (): ReaGenerationPlan => ({ version: 1, projectId: 'p', sourceAssetId: 'source', sourceEpoch: 'epoch-1', reviewVersion: 1,
  shotId: 'shot', sourceStartMs: 0, sourceEndMs: 4000, prompt: 'A paper boat', provider: 'minimax-video-payg', baseUrl: 'https://api.minimax.io',
  model: 'MiniMax-H3', resolution: '768P', generateAudio: false, durationSeconds: 4, ratio: '16:9', referenceImage: null,
  estimate: { currency: 'USD', outputMicroUsdPerSecond: 80000, totalMicroUsd: 320000, budgetMicroUsd: 320000, pricedAt: '2026-11-27', billingCapGuaranteed: false },
  manifest: { prompt: true, firstFrame: false, sourceVideo: false, sourceAudio: false } });
const directories: string[] = [];
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function setup(handler: OfflineVideoTransport['request'] = async () => ({ status: 200, body: '{"task_id":"remote-1"}' })) {
  // Any accidental fetch is a failing tripwire, not a paid provider fixture.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('EXTERNAL_NETWORK_FORBIDDEN'); }));
  const directory = await mkdtemp(join(tmpdir(), 'rea-offline-')); directories.push(directory);
  const request = vi.fn(handler), adapter = new MinimaxVideoAdapter({ kind: 'offline-fixture', request });
  let now = 1000;
  const store = new ReaGenerationJobStore(directory, adapter, () => now);
  return { store, adapter, request, directory, advance: (ms: number) => { now += ms; } };
}
describe('REA offline generation failure boundaries', () => {
  it('rejects unknown cost, raw keys, wrong model and noninteger duration before POST', async () => {
    const { store, request } = await setup();
    for (const extra of [{ apiKey: 'fake-key' }, { acceptUnknownCost: true }, { durationSeconds: 4.5 }, { model: 'MiniMax-H3-Lite' }, { estimate: { ...plan().estimate, totalMicroUsd: null } }]) {
      expect(() => store.prepare({ ...plan(), ...extra })).toThrow();
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('binds first-frame bytes and uses only an explicitly approved first frame', async () => {
    const { store, request } = await setup(); const p = plan(), image = new Uint8Array([1, 2, 3]);
    p.referenceImage = { assetId: 'frame', sha256: createHash('sha256').update(image).digest('hex'), byteLength: 3, mimeType: 'image/png' };
    p.manifest.firstFrame = true; p.ratio = 'adaptive';
    const a = await store.prepare(p); await store.submit(a.receipt.id, a.approval, p, new Uint8Array([4, 5, 6]));
    expect(request).not.toHaveBeenCalled();
    const b = await store.prepare(p); await store.submit(b.receipt.id, b.approval, p, image);
    expect(JSON.parse(request.mock.calls[0]![0].body!).content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' }, role: 'first_frame' });
  });
  it('rejects even whitespace changes to the approved final prompt', async () => {
    const { store, request } = await setup(); const p = plan(), a = await store.prepare(p); p.prompt += ' ';
    await expect(store.submit(a.receipt.id, a.approval, p)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
  });
  it('bounds timeout without retry and records the unknown outcome', async () => {
    const { store, request } = await setup(async () => new Promise(() => undefined));
    const p = plan(), a = await store.prepare(p); vi.useFakeTimers(); const submitting = store.submit(a.receipt.id, a.approval, p);
    // Persistence is real IO: wait for transport entry before advancing its timer.
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10001); expect((await submitting).state).toBe('outcome-unknown');
    expect(request.mock.calls[0]![0].signal.aborted).toBe(true);
    await expect(store.submit(a.receipt.id, a.approval, p)).rejects.toThrow(); expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(['foreign-id', 'wrong-model', 'wrong-type', 'unknown-state', 'oversize', 'http-error'])('preserves task ID after invalid poll %s', async invalid => {
    const task = { id: 'remote-1', model: 'MiniMax-H3', status: 'running', task_type: 'generation', modality: 'video', resolution: '768P', duration: 4 };
    if (invalid === 'foreign-id') task.id = 'foreign'; if (invalid === 'wrong-model') task.model = 'other';
    if (invalid === 'wrong-type') task.task_type = 'regeneration'; if (invalid === 'unknown-state') task.status = 'pending';
    const { store } = await setup(async r => r.method === 'POST' ? { status: 200, body: '{"task_id":"remote-1"}' } : { status: invalid === 'http-error' ? 500 : 200, body: invalid === 'oversize' ? ' '.repeat(262145) : JSON.stringify({ task }) });
    const p = plan(), a = await store.prepare(p); await store.submit(a.receipt.id, a.approval, p);
    expect(await store.poll(a.receipt.id, 'p')).toMatchObject({ state: 'queued', taskId: 'remote-1' });
  });
  it('is disabled in production and sends only the fixed official wire to a fixture', async () => {
    const { store, request } = await setup(); const p = plan(); const prepared = await store.prepare(p);
    expect(REA_GENERATION_POLICY.paidExecutionAllowed).toBe(false);
    const r = await store.submit(prepared.receipt.id, prepared.approval, p);
    expect(r).toMatchObject({ state: 'queued', taskId: 'remote-1', assetVerified: false });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0]![0].body!)).toEqual({ model: 'MiniMax-H3', content: [{ type: 'text', text: 'A paper boat' }], resolution: '768P', duration: 4, ratio: '16:9', generate_audio: false, response_format: 'task' });
    await expect(store.submit(r.id, prepared.approval, p)).rejects.toThrow('APPROVAL_REJECTED');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['projectId', 'sourceEpoch', 'prompt', 'shotId', 'reviewVersion', 'sourceStartMs', 'budget'] as const)('rejects changed %s before POST', async field => {
    const { store, request } = await setup(); const p = plan(), a = await store.prepare(p), changed = structuredClone(p);
    if (field === 'budget') changed.estimate.budgetMicroUsd++;
    else if (field === 'reviewVersion' || field === 'sourceStartMs') changed[field]++;
    else changed[field] += '-changed';
    await expect(store.submit(a.receipt.id, a.approval, changed)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
  });
  it('expires approvals and prevents concurrent replay', async () => {
    const { store, request, advance } = await setup(); const p = plan(), a = await store.prepare(p);
    advance(300000); await expect(store.submit(a.receipt.id, a.approval, p)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
    const b = await store.prepare(p);
    const results = await Promise.allSettled([store.submit(b.receipt.id, b.approval, p), store.submit(b.receipt.id, b.approval, p)]);
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']); expect(request).toHaveBeenCalledTimes(1);
  });
  it('persists ambiguous POST outcome and never resubmits after restart', async () => {
    const { store, adapter, request, directory } = await setup(async () => { throw new Error('secret signed-url upstream error'); });
    const p = plan(), a = await store.prepare(p); expect((await store.submit(a.receipt.id, a.approval, p)).state).toBe('outcome-unknown');
    const restarted = new ReaGenerationJobStore(directory, adapter);
    await expect(restarted.submit(a.receipt.id, a.approval, p)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1); expect(await readFile(join(directory, 'jobs.json'), 'utf8')).not.toContain('secret');
  });
  it('recovers a crash in submitting without POST', async () => {
    const { store, adapter, request, directory } = await setup(); const a = await store.prepare(plan());
    const path = join(directory, 'jobs.json'), data = JSON.parse(await readFile(path, 'utf8')); data[0].state = 'submitting'; await writeFile(path, JSON.stringify(data));
    expect((await new ReaGenerationJobStore(directory, adapter).get(a.receipt.id, 'p')).state).toBe('outcome-unknown'); expect(request).not.toHaveBeenCalled();
  });
  it.each(['cancelled', 'deleted'] as const)('retains confirmed remote action %s without claiming deletion is cancellation', async action => {
    const { store, request } = await setup(async r => ({ status: 200, body: r.method === 'POST' ? '{"task_id":"remote-1"}' : JSON.stringify({ task_id: 'remote-1', action, status: action }) }));
    const p = plan(), a = await store.prepare(p); await store.submit(a.receipt.id, a.approval, p);
    const result = await store.cancel(a.receipt.id, 'p'); expect(result.remoteAction).toBe(action); expect(result.state).toBe(action === 'cancelled' ? 'cancelled' : 'outcome-unknown');
    expect(request.mock.calls[1]![0]).toMatchObject({ method: 'DELETE', path: '/v2/video_generation/remote-1' });
  });
  it.each([{}, { task_id: 'foreign', action: 'cancelled', status: 'cancelled' }, { task_id: 'remote-1', action: 'deleted', status: 'cancelled' }])('does not confirm malformed cancellation %j', async response => {
    const { store } = await setup(async r => ({ status: 200, body: r.method === 'POST' ? '{"task_id":"remote-1"}' : JSON.stringify(response) }));
    const p = plan(), a = await store.prepare(p); await store.submit(a.receipt.id, a.approval, p);
    expect(await store.cancel(a.receipt.id, 'p')).toMatchObject({ state: 'queued', cancelRequested: true, taskId: 'remote-1' });
  });
  it('does not DELETE a running task and bounds repeated polling', async () => {
    const { store, request } = await setup(async r => ({ status: 200, body: r.method === 'POST' ? '{"task_id":"remote-1"}' : JSON.stringify({ task: { id: 'remote-1', model: 'MiniMax-H3', status: 'running', task_type: 'generation', modality: 'video', resolution: '768P', duration: 4 } }) }));
    const p = plan(), a = await store.prepare(p); await store.submit(a.receipt.id, a.approval, p); await store.poll(a.receipt.id, 'p');
    expect(await store.cancel(a.receipt.id, 'p')).toMatchObject({ state: 'running', cancelRequested: true });
    await expect(store.poll(a.receipt.id, 'p')).rejects.toThrow('POLL_BOUND'); expect(request).toHaveBeenCalledTimes(2);
  });
});
