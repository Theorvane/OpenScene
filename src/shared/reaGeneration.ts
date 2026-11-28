import { z } from 'zod';

export const REA_GENERATION_POLICY = Object.freeze({
  provider: 'minimax-video-payg', baseUrl: 'https://api.minimax.io', model: 'MiniMax-H3',
  resolution: '768P', generateAudio: false, paidExecutionAllowed: false,
  documentationCheckedAt: '2026-11-27',
  openApiSha256: '3aecabd65a846412637bb0f482a69885f902355fc5a514682201858986095171'
} as const);
const id = z.string().min(1).max(160).regex(/^[\w-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const reaGenerationPlanSchema = z.strictObject({
  version: z.literal(1), projectId: id, sourceAssetId: id, sourceEpoch: z.string().min(1).max(512),
  reviewVersion: z.number().int().nonnegative(), shotId: id,
  sourceStartMs: z.number().int().nonnegative(), sourceEndMs: z.number().int().positive(),
  prompt: z.string().min(1).max(12000).refine(value => value.trim().length > 0),
  provider: z.literal('minimax-video-payg'), baseUrl: z.literal('https://api.minimax.io'),
  model: z.literal('MiniMax-H3'), resolution: z.literal('768P'), generateAudio: z.literal(false),
  durationSeconds: z.number().int().min(4).max(15),
  ratio: z.enum(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive']),
  referenceImage: z.strictObject({ assetId: id, sha256: hash, byteLength: z.number().int().positive().max(5_000_000), mimeType: z.enum(['image/png', 'image/jpeg']) }).nullable(),
  estimate: z.strictObject({ currency: z.literal('USD'), outputMicroUsdPerSecond: z.literal(80000),
    totalMicroUsd: z.number().int().nonnegative(), budgetMicroUsd: z.number().int().nonnegative(),
    pricedAt: z.literal('2026-11-27'), billingCapGuaranteed: z.literal(false) }),
  manifest: z.strictObject({ prompt: z.literal(true), firstFrame: z.boolean(), sourceVideo: z.literal(false), sourceAudio: z.literal(false) })
}).superRefine((p, ctx) => {
  if (p.sourceEndMs <= p.sourceStartMs || p.manifest.firstFrame !== Boolean(p.referenceImage)
    || (p.referenceImage ? p.ratio !== 'adaptive' : p.ratio === 'adaptive')
    || p.estimate.totalMicroUsd !== p.durationSeconds * 80000
    || p.estimate.budgetMicroUsd < p.estimate.totalMicroUsd) ctx.addIssue({ code: 'custom', message: 'Invalid generation plan' });
});
export type ReaGenerationPlan = z.infer<typeof reaGenerationPlanSchema>;
export type ReaGenerationState = 'awaiting-approval' | 'submitting' | 'outcome-unknown' | 'queued' | 'running' | 'remote-succeeded' | 'failed' | 'cancelled';
export interface ReaGenerationReceipt {
  id: string; planHash: string; state: ReaGenerationState; taskId?: string;
  cancelRequested: boolean; remoteAction?: 'cancelled' | 'deleted';
  // A remote success is deliberately not an imported or verified local asset.
  assetVerified: false;
}
