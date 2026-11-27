import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReaGenerationJobStore } from '../src/main/reaGenerationJobStore';
import { MinimaxVideoAdapter } from '../src/main/minimaxVideoAdapter';
import type { ReaGenerationPlan } from '../src/shared/reaGeneration';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { force: true, recursive: true }))); });
const plan: ReaGenerationPlan = { version: 1, projectId: 'p', sourceAssetId: 'source', sourceEpoch: 'e', reviewVersion: 1, shotId: 's', sourceStartMs: 0, sourceEndMs: 4000,
  prompt: 'Boat', provider: 'minimax-video-payg', baseUrl: 'https://api.minimax.io', model: 'MiniMax-H3', resolution: '768P', generateAudio: false, durationSeconds: 4, ratio: '16:9', referenceImage: null,
  estimate: { currency: 'USD', outputMicroUsdPerSecond: 80000, totalMicroUsd: 320000, budgetMicroUsd: 320000, pricedAt: '2026-11-27', billingCapGuaranteed: false }, manifest: { prompt: true, firstFrame: false, sourceVideo: false, sourceAudio: false } };
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'rea-retention-')); dirs.push(directory);
  const request = vi.fn(async () => ({ status: 200, body: '{"task_id":"remote"}' })), adapter = new MinimaxVideoAdapter({ kind: 'offline-fixture', request });
  let now = 1000; const clock = () => now;
  return { directory, adapter, store: new ReaGenerationJobStore(directory, adapter, clock), request, clock, advance: () => { now += 300001; } };
}
async function seed(h: Awaited<ReturnType<typeof setup>>, customize: (r: Record<string, unknown>, i: number) => void) {
  await h.store.prepare(plan); const template = JSON.parse(await readFile(join(h.directory, 'jobs.json'), 'utf8'))[0];
  const rows = Array.from({ length: 100 }, (_, i) => { const r = { ...structuredClone(template), id: randomUUID() }; customize(r, i); return r; });
  await writeFile(join(h.directory, 'jobs.json'), JSON.stringify(rows)); return { rows, store: new ReaGenerationJobStore(h.directory, h.adapter, h.clock) };
}
it('permits 105 actual prepare/cancel cycles and another preparation after restart, without POST', async () => {
  const h = await setup(); let store = h.store; let first = '';
  for (let i = 0; i < 105; i++) { const a = await store.prepare(plan); if (!i) first = a.receipt.id; await store.cancel(a.receipt.id, 'p'); if (i === 99) store = new ReaGenerationJobStore(h.directory, h.adapter, h.clock); }
  expect((await store.prepare(plan)).receipt.state).toBe('awaiting-approval');
  expect(JSON.parse(await readFile(join(h.directory, 'jobs.json'), 'utf8'))).toHaveLength(100);
  await expect(store.get(first, 'p')).rejects.toThrow('JOB_NOT_FOUND'); expect(h.request).not.toHaveBeenCalled();
}, 30000);
it('evicts oldest safe cancelled then expired entries and preserves submitted/unknown/valid/result records', async () => {
  const h = await setup(); const { rows, store } = await seed(h, (r, i) => {
    if (i === 0) { r.state = 'cancelled'; r.approvalHash = ''; }
    if (i === 1) { r.state = 'cancelled'; r.dispatchStarted = true; r.approvalHash = ''; }
    if (i === 2) { r.state = 'cancelled'; r.taskId = 'remote'; r.remoteAction = 'cancelled'; }
    if (i === 3) { r.state = 'outcome-unknown'; r.expiresAt = 0; }
    if (i === 4) { r.state = 'queued'; r.taskId = 'queued-remote'; }
    if (i === 5) r.expiresAt = 0;
    if (i === 6) { r.state = 'running'; r.taskId = 'running-remote'; }
    if (i === 7) { r.state = 'remote-succeeded'; r.taskId = 'result-remote'; }
  });
  await store.prepare(plan); await store.prepare(plan);
  const retained = JSON.parse(await readFile(join(h.directory, 'jobs.json'), 'utf8')).map((r: { id: string }) => r.id);
  expect(retained).not.toContain(rows[0]!.id); expect(retained).not.toContain(rows[5]!.id);
  for (const i of [1, 2, 3, 4, 6, 7, 8]) expect(await store.get(rows[i]!.id, 'p')).toMatchObject({ id: rows[i]!.id });
  await expect(store.prepare(plan)).rejects.toThrow('JOB_LIMIT'); expect(h.request).not.toHaveBeenCalled();
});
it('retires expired never-dispatched approvals across restart without resurrecting their tokens', async () => {
  const h = await setup(); const { rows, store } = await seed(h, () => {}); h.advance(); await store.prepare(plan);
  const restarted = new ReaGenerationJobStore(h.directory, h.adapter, h.clock); await restarted.prepare(plan);
  await expect(restarted.submit(rows[0]!.id, randomUUID(), plan)).rejects.toThrow('JOB_NOT_FOUND'); expect(h.request).not.toHaveBeenCalled();
});
it('serializes concurrent prepares and honestly refuses when all remaining records are protected', async () => {
  const h = await setup(); const { store } = await seed(h, (r, i) => { if (i === 0) { r.state = 'cancelled'; r.approvalHash = ''; } });
  expect((await Promise.allSettled([store.prepare(plan), store.prepare(plan)])).map(r => r.status)).toEqual(['fulfilled', 'rejected']);
  await expect(new ReaGenerationJobStore(h.directory, h.adapter, h.clock).prepare(plan)).rejects.toThrow('JOB_LIMIT'); expect(h.request).not.toHaveBeenCalled();
});
it('protects legacy ambiguous/submitting records even with expired approval metadata', async () => {
  const h = await setup(); const { store } = await seed(h, (r, i) => { delete r.dispatchStarted; r.state = i % 2 ? 'submitting' : 'outcome-unknown'; r.expiresAt = 0; });
  await expect(store.prepare(plan)).rejects.toThrow('JOB_LIMIT'); expect(h.request).not.toHaveBeenCalled();
});
it('rolls back a failed retention replacement and preserves the old recoverable record', async () => {
  const h = await setup(); const { rows, store } = await seed(h, (r, i) => { if (i === 0) { r.state = 'cancelled'; r.approvalHash = ''; } });
  await store.get(rows[0]!.id, 'p'); await rename(h.directory, `${h.directory}-checkpoint`); await writeFile(h.directory, 'blocked');
  try {
    await expect(store.prepare(plan)).rejects.toThrow(); expect(await store.get(rows[0]!.id, 'p')).toMatchObject({ state: 'cancelled' });
    await rm(h.directory); await rename(`${h.directory}-checkpoint`, h.directory);
    const restarted = new ReaGenerationJobStore(h.directory, h.adapter, h.clock); expect(await restarted.get(rows[0]!.id, 'p')).toMatchObject({ state: 'cancelled' });
    await restarted.prepare(plan); expect(h.request).not.toHaveBeenCalled();
  } finally { await rm(`${h.directory}-checkpoint`, { force: true, recursive: true }); }
});
