import { hasAllowedKeys, isPlainRecord } from './timelineValidationPrimitives';
import type { ShortsStartInput } from './shortsTypes';
export const isShortsId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
export function parseShortsStart(value: unknown): ShortsStartInput | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['projectId', 'assetId', 'modelId', 'openAiAuthMode', 'ollamaBaseUrl', 'reasoningEffort', 'requestedCount', 'minDurationMs', 'maxDurationMs']) ||
    !isShortsId(value.projectId) || !isShortsId(value.assetId) || typeof value.modelId !== 'string' || !value.modelId.trim() || value.modelId.length > 200 ||
    (value.openAiAuthMode !== undefined && value.openAiAuthMode !== 'api-key' && value.openAiAuthMode !== 'chatgpt') ||
    (value.ollamaBaseUrl !== undefined && (typeof value.ollamaBaseUrl !== 'string' || value.ollamaBaseUrl.length > 2000)) ||
    (value.reasoningEffort !== undefined && (typeof value.reasoningEffort !== 'string' || value.reasoningEffort.length > 50))) return null;
  for (const key of ['requestedCount', 'minDurationMs', 'maxDurationMs'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) || value[key] <= 0)) return null;
  }
  if ((value.requestedCount as number | undefined ?? 4) > 5 || (value.minDurationMs as number | undefined ?? 15000) > (value.maxDurationMs as number | undefined ?? 60000)) return null;
  return value as unknown as ShortsStartInput;
}
export function parseShortsAction(value: unknown, idsKey?: 'candidateIds' | 'resultProjectIds'): { jobId: string; ids: readonly string[] } | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, idsKey === undefined ? ['jobId'] : ['jobId', idsKey]) || !isShortsId(value.jobId)) return null;
  const ids = idsKey === undefined ? [] : value[idsKey];
  if (!Array.isArray(ids) || (idsKey !== undefined && (ids.length < 1 || ids.length > 5)) || !ids.every(isShortsId) || new Set(ids).size !== ids.length) return null;
  return { jobId: value.jobId, ids };
}
