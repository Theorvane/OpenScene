import type { MinimaxVideoAdapter } from './minimaxVideoAdapter';
import type { ReaGenerationJobStore } from './reaGenerationJobStore';
import type { ReaGenerationResultService } from './reaGenerationResultService';
import type { ReaGenerationPlan } from '../shared/reaGeneration';

/** Concrete main integration caller; production observation is gated separately. */
export class ReaGenerationRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly active = new Set<Promise<unknown>>();
  constructor(private readonly jobs: ReaGenerationJobStore, private readonly adapter: MinimaxVideoAdapter, private readonly results: ReaGenerationResultService,
    private readonly allowed = () => false, mode: 'global-payg' | 'offline-fixture' = 'global-payg') {
    if (adapter.isOfflineFixture !== (mode === 'offline-fixture')) throw new Error('TRANSPORT_MODE_MISMATCH');
  }
  submit(id: string, approval: string, currentPlan: ReaGenerationPlan, image?: Uint8Array) {
    if (!this.allowed()) throw new Error('PAID_EXECUTION_DISABLED'); return this.jobs.submit(id, approval, currentPlan, image);
  }
  async observe(id: string, projectId: string) {
    const task = this.observeInternal(id, projectId); this.active.add(task);
    try { return await task; } finally { this.active.delete(task); }
  }
  private async observeInternal(id: string, projectId: string) {
    if (!this.allowed()) return { receipt: await this.jobs.get(id, projectId), result: null };
    if (this.controllers.has(id)) throw new Error('OBSERVATION_IN_PROGRESS');
    const controller = new AbortController(); this.controllers.set(id, controller);
    try {
      const receipt = await this.jobs.poll(id, projectId);
      if (controller.signal.aborted) throw new Error('RESULT_RETIRED');
      if (receipt.state !== 'remote-succeeded' || receipt.cancelRequested || !receipt.taskId) return { receipt, result: null };
      const plan = await this.jobs.getPlan(id, projectId);
      if (controller.signal.aborted) throw new Error('RESULT_RETIRED');
      const existing = this.results.get(id, projectId, plan.sourceEpoch);
      if (existing) return { receipt, result: existing };
      await this.jobs.claimResultCollection(id, projectId);
      if (controller.signal.aborted || !this.allowed()) throw new Error('RESULT_RETIRED');
      const url = await this.adapter.resultUrl(receipt.taskId, plan.durationSeconds);
      if (controller.signal.aborted) throw new Error('RESULT_RETIRED');
      return { receipt, result: await this.results.receive(receipt, plan, url, controller.signal) };
    } finally { if (this.controllers.get(id) === controller) this.controllers.delete(id); }
  }
  async cancel(id: string, projectId: string) {
    await this.jobs.get(id, projectId);
    this.controllers.get(id)?.abort(); this.results.retire(id);
    return this.jobs.cancel(id, projectId);
  }
  async dispose() { for (const controller of this.controllers.values()) controller.abort(); await Promise.allSettled([...this.active]); }
}
/** Test-only explicit mode: fixture permission cannot enable the production runner. */
export class OfflineReaGenerationRunner extends ReaGenerationRunner {
  constructor(jobs: ReaGenerationJobStore, adapter: MinimaxVideoAdapter, results: ReaGenerationResultService) {
    super(jobs, adapter, results, () => true, 'offline-fixture');
  }
}
