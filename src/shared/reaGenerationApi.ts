import type { ApiResponse } from './models';
import type { ReaGenerationPlan, ReaGenerationReceipt } from './reaGeneration';

export const REA_VIDEO_CREDENTIAL_SLOT = 'minimax-video-payg' as const;
export const REA_GENERATION_CHANNELS = {
  status: 'rea-generation:status', setCredential: 'rea-generation:set-credential', clearCredential: 'rea-generation:clear-credential',
  prepare: 'rea-generation:prepare', get: 'rea-generation:get', cancel: 'rea-generation:cancel'
} as const;
export interface ReaGenerationCapability {
  readonly provider: 'minimax-video-payg'; readonly region: 'global'; readonly billing: 'PAYG';
  readonly documentationCheckedAt: '2026-11-27'; readonly adapterImplemented: false;
  readonly offlineAdapterImplemented: true; readonly credentialConfigured: boolean;
  readonly accountAccessVerified: false; readonly paidExecutionAllowed: false;
}
export interface ReaGenerationPrepared { readonly receipt: ReaGenerationReceipt; readonly plan: ReaGenerationPlan; readonly approval: string }
export interface ReaGenerationApi {
  reaGenerationStatus(): Promise<ApiResponse<ReaGenerationCapability>>;
  reaGenerationSetCredential(input: { readonly value: string }): Promise<ApiResponse<{ readonly updated: true }>>;
  reaGenerationClearCredential(): Promise<ApiResponse<{ readonly updated: true }>>;
  reaGenerationPrepare(input: ReaGenerationPlan): Promise<ApiResponse<ReaGenerationPrepared>>;
  reaGenerationGet(input: { readonly id: string; readonly projectId: string }): Promise<ApiResponse<ReaGenerationReceipt>>;
  reaGenerationCancel(input: { readonly id: string; readonly projectId: string }): Promise<ApiResponse<ReaGenerationReceipt>>;
}
