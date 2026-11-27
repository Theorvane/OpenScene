import type { MinimaxVideoAdapter } from './minimaxVideoAdapter';
import type { ReaGenerationJobStore } from './reaGenerationJobStore';
import type { ReaGenerationResultService } from './reaGenerationResultService';
import type { ReaGenerationPlan } from '../shared/reaGeneration';

/** Concrete offline integration caller. It never creates or selects a production transport. */
export class OfflineReaGenerationRunner {
  private readonly controllers = new Map<string, AbortController>();
  constructor(private readonly jobs: ReaGenerationJobStore, private readonly adapter: MinimaxVideoAdapter, private readonly results: ReaGenerationResultService) {}
  submit(id: string, approval: string, currentPlan: ReaGenerationPlan, image?: Uint8Array) { return this.jobs.submit(id, approval, currentPlan, image); }
  async observe(id: string, projectId: string) {
    if (this.controllers.has(id)) throw new Error('OBSERVATION_IN_PROGRESS');
    const controller = new AbortController(); this.controllers.set(id, controller);
    try {
      const receipt = await this.jobs.poll(id, projectId);
      if (receipt.state !== 'remote-succeeded' || receipt.cancelRequested || !receipt.taskId) return { receipt, result: null };
      const plan = await this.jobs.getPlan(id, projectId);
      const existing = this.results.get(id, projectId, plan.sourceEpoch);
      if (existing) return { receipt, result: existing };
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
}
