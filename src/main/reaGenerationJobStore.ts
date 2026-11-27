import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { reaGenerationPlanSchema, type ReaGenerationReceipt } from '../shared/reaGeneration';
import { freezeGenerationPlan, generationPlanHash } from './reaGenerationPlan';
import type { MinimaxVideoAdapter } from './minimaxVideoAdapter';

const recordSchema = z.strictObject({ id: z.string().uuid(), plan: reaGenerationPlanSchema, planHash: z.string().regex(/^[a-f0-9]{64}$/),
  approvalHash: z.string(), expiresAt: z.number().int(), state: z.enum(['awaiting-approval', 'submitting', 'outcome-unknown', 'queued', 'running', 'remote-succeeded', 'failed', 'cancelled']),
  taskId: z.string().regex(/^[\w-]{1,160}$/).optional(), dispatchStarted: z.boolean().default(false), cancelRequested: z.boolean(), remoteAction: z.enum(['cancelled', 'deleted']).optional(),
  pollCount: z.number().int().nonnegative(), nextPollAt: z.number().int(), deadline: z.number().int() });
type Record = z.infer<typeof recordSchema>;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

/** One main-process owner per directory. All mutations, including approval consumption, serialize. */
export class ReaGenerationJobStore {
  private work: Promise<unknown> = Promise.resolve();
  private records: Record[] = [];
  private loaded = false;
  constructor(private readonly directory: string, private readonly adapter: Pick<MinimaxVideoAdapter, 'submit' | 'query' | 'cancelQueued'>, private readonly now = Date.now) {}
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.work.then(async () => { await this.load(); return fn(); });
    this.work = result.catch(() => undefined);
    return result;
  }
  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const bytes = await readFile(join(this.directory, 'jobs.json'));
      if (bytes.length > 4_000_000) throw new Error('STORE_TOO_LARGE');
      this.records = z.array(recordSchema).max(100).parse(JSON.parse(bytes.toString()));
      for (const r of this.records) {
        if (generationPlanHash(r.plan) !== r.planHash) throw new Error('CORRUPT_PLAN');
        if (r.state === 'submitting') r.state = 'outcome-unknown';
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('GENERATION_STORE_UNAVAILABLE'); }
    await this.persist();
    this.loaded = true;
  }
  private async persist(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    const f = await open(temporary, 'wx', 0o600);
    try {
      await f.writeFile(JSON.stringify(this.records)); await f.sync(); await f.close();
      await rename(temporary, join(this.directory, 'jobs.json'));
      const dir = await open(this.directory, 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    } catch (error) { await f.close().catch(() => undefined); await rm(temporary, { force: true }); throw error; }
  }
  private receipt(r: Record): ReaGenerationReceipt {
    return { id: r.id, planHash: r.planHash, state: r.state, cancelRequested: r.cancelRequested, assetVerified: false,
      ...(r.taskId ? { taskId: r.taskId } : {}), ...(r.remoteAction ? { remoteAction: r.remoteAction } : {}) };
  }
  private find(id: string, projectId: string): Record {
    const r = this.records.find(r => r.id === id && r.plan.projectId === projectId);
    if (!r) throw new Error('JOB_NOT_FOUND');
    return r;
  }
  prepare(value: unknown): Promise<{ receipt: ReaGenerationReceipt; approval: string }> {
    const plan = freezeGenerationPlan(value);
    return this.serialize(async () => {
      const now = this.now(), approval = randomUUID();
      // Only records proven never dispatched can be retired. Array order is the
      // persisted creation order; select the oldest eligible record deterministically.
      const records = [...this.records];
      if (records.length >= 100) {
        const index = records.findIndex(r => !r.taskId && !r.dispatchStarted && !r.remoteAction &&
          (r.state === 'cancelled' || r.state === 'awaiting-approval' && r.approvalHash.length === 64 && now >= r.expiresAt));
        if (index < 0) throw new Error('JOB_LIMIT');
        records.splice(index, 1);
      }
      const r: Record = { id: randomUUID(), plan, planHash: generationPlanHash(plan), approvalHash: digest(approval), expiresAt: now + 300000,
        state: 'awaiting-approval', dispatchStarted: false, cancelRequested: false, pollCount: 0, nextPollAt: now, deadline: now + 1800000 };
      records.push(r); const previous = this.records; this.records = records;
      try { await this.persist(); } catch (error) { this.records = previous; throw error; }
      return { receipt: this.receipt(r), approval };
    });
  }
  get(id: string, projectId: string): Promise<ReaGenerationReceipt> { return this.serialize(async () => this.receipt(this.find(id, projectId))); }
  /** Main-only approved context; no IPC exposes arbitrary persisted plans. */
  getPlan(id: string, projectId: string) { return this.serialize(async () => freezeGenerationPlan(this.find(id, projectId).plan)); }
  submit(id: string, approval: string, currentPlan: unknown, image?: Uint8Array): Promise<ReaGenerationReceipt> {
    // Capture caller-owned inputs before the first await.
    const plan = freezeGenerationPlan(currentPlan), bytes = image?.slice();
    return this.serialize(async () => {
      const r = this.find(id, plan.projectId);
      if (r.state !== 'awaiting-approval' || r.cancelRequested || this.now() >= r.expiresAt || digest(approval) !== r.approvalHash || generationPlanHash(plan) !== r.planHash) throw new Error('APPROVAL_REJECTED');
      r.state = 'submitting'; r.dispatchStarted = true; r.approvalHash = ''; await this.persist();
      try {
        r.taskId = await this.adapter.submit(plan, bytes);
        r.state = 'queued'; await this.persist();
      } catch {
        // Includes response loss, invalid 200, timeout, and failure persisting the returned task ID.
        // Never reset approval or automatically repeat POST.
        r.state = 'outcome-unknown'; await this.persist();
      }
      return this.receipt(r);
    });
  }
  poll(id: string, projectId: string): Promise<ReaGenerationReceipt> {
    return this.serialize(async () => {
      const r = this.find(id, projectId), now = this.now();
      if (!r.taskId || !['queued', 'running', 'outcome-unknown'].includes(r.state) || r.remoteAction === 'deleted') return this.receipt(r);
      if (now >= r.deadline || r.pollCount >= 120 || now < r.nextPollAt) throw new Error('POLL_BOUND');
      r.pollCount++; r.nextPollAt = now + Math.min(30000, 1000 * 2 ** Math.min(r.pollCount, 5)); await this.persist();
      try { const state = await this.adapter.query(r.taskId, r.plan.durationSeconds); r.state = state === 'succeeded' ? 'remote-succeeded' : state; }
      catch { /* Retain remote ID/state; observation failure is not generation failure. */ }
      await this.persist(); return this.receipt(r);
    });
  }
  cancel(id: string, projectId: string): Promise<ReaGenerationReceipt> {
    return this.serialize(async () => {
      const r = this.find(id, projectId); r.cancelRequested = true; await this.persist();
      if (r.state === 'awaiting-approval') { r.state = 'cancelled'; r.approvalHash = ''; }
      else if (r.state === 'queued' && r.taskId) {
        try {
          r.remoteAction = await this.adapter.cancelQueued(r.taskId);
          r.state = r.remoteAction === 'cancelled' ? 'cancelled' : 'outcome-unknown';
        } catch { /* Not confirmed; keep queued and preserve taskId. */ }
      }
      await this.persist(); return this.receipt(r);
    });
  }
}
