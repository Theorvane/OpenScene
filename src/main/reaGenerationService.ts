import { z } from 'zod';
import { REA_VIDEO_CREDENTIAL_SLOT, type ReaGenerationCapability } from '../shared/reaGenerationApi';
import { freezeGenerationPlan } from './reaGenerationPlan';
import type { ReaGenerationJobStore } from './reaGenerationJobStore';
import type { CredentialStore } from './credentialStore';
import type { ReaGenerationResultService } from './reaGenerationResultService';
import type { ReaGenerationPlan } from '../shared/reaGeneration';
import type { ReaGenerationSubmission } from './reaGenerationSubmission';
import type { ReaGenerationRunner } from './reaGenerationRunner';

const scope = z.strictObject({ id: z.string().uuid(), projectId: z.string().regex(/^[\w-]{1,160}$/) });
const resultScope = z.strictObject({ jobId: z.string().uuid(), projectId: z.string().regex(/^[\w-]{1,160}$/), sourceEpoch: z.string().min(1).max(512) });
export class ReaGenerationService {
  private readonly localWork = new Map<string, { controller: AbortController; task: Promise<unknown> }>();
  constructor(private readonly credentials: Pick<CredentialStore, 'getCredentialValue' | 'setCredential'>,
    private readonly jobs: ReaGenerationJobStore,
    private readonly sourceExists: (projectId: string, assetId: string) => Promise<boolean>,
    private readonly results?: ReaGenerationResultService,
    private readonly trackExists?: (projectId: string, trackId: string) => Promise<boolean>,
    private readonly referenceResolver?: (projectId: string, assetId: string) => Promise<NonNullable<ReaGenerationPlan['referenceImage']>>,
    private readonly submission?: ReaGenerationSubmission,
    private readonly captureSource?: (plan: ReaGenerationPlan) => Promise<string>,
    private readonly observer?: Pick<ReaGenerationRunner, 'observe' | 'cancel' | 'dispose'>) {}
  async status(): Promise<ReaGenerationCapability> {
    // A configured key says nothing about video access or permission to spend.
    const key = await this.credentials.getCredentialValue(REA_VIDEO_CREDENTIAL_SLOT);
    return { provider: REA_VIDEO_CREDENTIAL_SLOT, region: 'global', billing: 'PAYG', documentationCheckedAt: '2026-11-27',
      adapterImplemented: Boolean(this.submission), offlineAdapterImplemented: true, credentialConfigured: Boolean(key?.trim()), accountAccessVerified: false, paidExecutionAllowed: false };
  }
  async setCredential(payload: unknown) {
    const { value } = z.strictObject({ value: z.string().min(1).max(4096).refine(v => v.trim() === v && !/[\r\n\0]/.test(v)) }).parse(payload);
    await this.credentials.setCredential(REA_VIDEO_CREDENTIAL_SLOT, value); return { updated: true as const };
  }
  async clearCredential() { await this.credentials.setCredential(REA_VIDEO_CREDENTIAL_SLOT, ''); return { updated: true as const }; }
  async prepare(payload: unknown) {
    const candidate = freezeGenerationPlan(payload);
    if (!await this.sourceExists(candidate.projectId, candidate.sourceAssetId)) throw new Error('SOURCE_UNAVAILABLE');
    if (candidate.referenceImage) {
      const current = await this.reference({ projectId: candidate.projectId, assetId: candidate.referenceImage.assetId });
      if (JSON.stringify(current) !== JSON.stringify(candidate.referenceImage)) throw new Error('REFERENCE_CHANGED');
    }
    const plan = this.captureSource ? freezeGenerationPlan({ ...candidate, sourceIdentity: await this.captureSource(candidate) }) : candidate;
    const prepared = await this.jobs.prepare(plan); return { ...prepared, plan };
  }
  async get(payload: unknown) { const p = scope.parse(payload); return this.observer ? (await this.observer.observe(p.id, p.projectId)).receipt : this.jobs.get(p.id, p.projectId); }
  async cancel(payload: unknown) { const p = scope.parse(payload); await this.jobs.get(p.id, p.projectId); this.localWork.get(p.id)?.controller.abort(); this.results?.retire(p.id); return this.observer ? this.observer.cancel(p.id, p.projectId) : this.jobs.cancel(p.id, p.projectId); }
  async getResult(payload: unknown) { const p = resultScope.parse(payload); return this.results?.get(p.jobId, p.projectId, p.sourceEpoch) ?? null; }
  async assemble(payload: unknown) {
    const p = resultScope.extend({ targetDurationMs: z.number().int().min(1000).max(15000) }).parse(payload);
    if (!this.results || this.localWork.has(p.jobId)) throw new Error('ASSEMBLY_UNAVAILABLE');
    const controller = new AbortController(), task = this.results.assemble(p.jobId, p.projectId, p.sourceEpoch, p.targetDurationMs, controller.signal);
    this.localWork.set(p.jobId, { controller, task });
    try { return await task; } finally { if (this.localWork.get(p.jobId)?.controller === controller) this.localWork.delete(p.jobId); }
  }
  async prepareImport(payload: unknown) {
    const p = resultScope.extend({ trackId: z.string(), atMs: z.number() }).parse(payload);
    if (!this.results || !this.trackExists || !await this.sourceExists(p.projectId, (await this.jobsPlanSource(p.jobId, p.projectId)))) throw new Error('IMPORT_UNAVAILABLE');
    return this.results.prepareImport(p, this.trackExists);
  }
  private async jobsPlanSource(id: string, projectId: string): Promise<string> { return (await this.jobs.getPlan(id, projectId)).sourceAssetId; }
  async reference(payload: unknown) {
    const p = z.strictObject({ projectId: z.string().regex(/^[\w-]{1,160}$/), assetId: z.string().regex(/^[\w-]{1,160}$/) }).parse(payload);
    if (!this.referenceResolver) throw new Error('REFERENCE_UNAVAILABLE');
    return this.referenceResolver(p.projectId, p.assetId);
  }
  async dispose() { const work = [...this.localWork.values()]; for (const item of work) item.controller.abort(); await Promise.allSettled([...work.map(item => item.task), this.observer?.dispose()]); }
  async submit(payload: unknown) { if (!this.submission) throw new Error('PAID_EXECUTION_DISABLED'); return this.submission.submit(payload); }
}
