import { expect, it, vi } from 'vitest';
import { settleShortsJob, runShortsJobTool } from '../src/main/shortsAgentTools';
import type { ShortsJob } from '../src/shared/shortsTypes';

const job: ShortsJob = { id: 'job', sourceProjectId: 'project', sourceAssetId: 'asset', stage: 'creating', cleanupComplete: false, items: [], createdAt: '', updatedAt: '' };
it('never starts approved provider work after its conversation has already been cancelled', async () => {
  const abort = new AbortController(); abort.abort();
  const start = vi.fn(async () => ({ ok: true as const, value: job }));
  const service = { getShortsJob: vi.fn(), cancelShortsJob: vi.fn() };
  expect(await runShortsJobTool(service, start, abort.signal)).toMatchObject({ ok: false });
  expect(start).not.toHaveBeenCalled();
});
it('returns the settled durable result so chat can propose the next approved step', async () => {
  const final = { ...job, stage: 'completed' as const, cleanupComplete: true, items: [{ candidateId: 'c', resultProjectId: 'result', status: 'ready' as const }] };
  const service = { getShortsJob: vi.fn(async () => ({ ok: true as const, value: final })), cancelShortsJob: vi.fn() };
  expect(await settleShortsJob(service, { ok: true, value: job }, undefined, 1)).toEqual({ ok: true, value: final });
});
it('cancels only its own active job on conversation cancellation without claiming cleanup finished', async () => {
  const signal = new AbortController(); signal.abort();
  const current = { ...job, stage: 'cancelling' as const };
  const service = { getShortsJob: vi.fn(async () => ({ ok: true as const, value: current })), cancelShortsJob: vi.fn(async () => ({ ok: true as const, value: { accepted: true } })) };
  expect(await settleShortsJob(service, { ok: true, value: job }, signal.signal, 1)).toEqual({ ok: true, value: current });
  expect(service.cancelShortsJob).toHaveBeenCalledExactlyOnceWith({ jobId: 'job' });
});
