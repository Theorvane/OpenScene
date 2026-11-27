import { z } from 'zod';
import { REA_VIDEO_CREDENTIAL_SLOT, type ReaGenerationCapability } from '../shared/reaGenerationApi';
import { freezeGenerationPlan } from './reaGenerationPlan';
import type { ReaGenerationJobStore } from './reaGenerationJobStore';
import type { CredentialStore } from './credentialStore';

const scope = z.strictObject({ id: z.string().uuid(), projectId: z.string().regex(/^[\w-]{1,160}$/) });
export class ReaGenerationService {
  constructor(private readonly credentials: Pick<CredentialStore, 'getCredentialValue' | 'setCredential'>,
    private readonly jobs: ReaGenerationJobStore,
    private readonly sourceExists: (projectId: string, assetId: string) => Promise<boolean>) {}
  async status(): Promise<ReaGenerationCapability> {
    // A configured key says nothing about video access or permission to spend.
    const key = await this.credentials.getCredentialValue(REA_VIDEO_CREDENTIAL_SLOT);
    return { provider: REA_VIDEO_CREDENTIAL_SLOT, region: 'global', billing: 'PAYG', documentationCheckedAt: '2026-11-27',
      adapterImplemented: false, offlineAdapterImplemented: true, credentialConfigured: Boolean(key?.trim()), accountAccessVerified: false, paidExecutionAllowed: false };
  }
  async setCredential(payload: unknown) {
    const { value } = z.strictObject({ value: z.string().min(1).max(4096).refine(v => v.trim() === v && !/[\r\n\0]/.test(v)) }).parse(payload);
    await this.credentials.setCredential(REA_VIDEO_CREDENTIAL_SLOT, value); return { updated: true as const };
  }
  async clearCredential() { await this.credentials.setCredential(REA_VIDEO_CREDENTIAL_SLOT, ''); return { updated: true as const }; }
  async prepare(payload: unknown) {
    const plan = freezeGenerationPlan(payload);
    if (!await this.sourceExists(plan.projectId, plan.sourceAssetId)) throw new Error('SOURCE_UNAVAILABLE');
    // First-frame production resolution/validation is not enabled in this dependency.
    if (plan.referenceImage) throw new Error('REFERENCE_UNAVAILABLE');
    const prepared = await this.jobs.prepare(plan); return { ...prepared, plan };
  }
  async get(payload: unknown) { const p = scope.parse(payload); return this.jobs.get(p.id, p.projectId); }
  async cancel(payload: unknown) { const p = scope.parse(payload); return this.jobs.cancel(p.id, p.projectId); }
}
