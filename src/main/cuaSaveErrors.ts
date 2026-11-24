/** Exact protocol values only. Renderer text and native IO messages are data,
 * never public error codes (even when they start with CUA_SAVE_). */
const PUBLIC_CODES: ReadonlySet<string> = new Set([
  'CUA_SAVE_FAILED', 'CUA_SAVE_SCOPE_CHANGED', 'CUA_SAVE_CANCELLED', 'CUA_SAVE_PROPOSAL_EXPIRED',
  'CUA_SAVE_BUSY', 'CUA_SAVE_BUDGET_EXCEEDED', 'CUA_SAVE_SNAPSHOT_TIMEOUT', 'CUA_SAVE_INVALID_TIMELINE',
  'CUA_SAVE_PROJECT_NOT_FOUND', 'CUA_SAVE_READY_TIMEOUT', 'CUA_SAVE_RENDERER_NOT_READY',
  'CUA_SAVE_BASELINE_CHANGED', 'CUA_SAVE_READBACK_FAILED', 'CUA_SAVE_PROPOSAL_NOT_FOUND',
  'CUA_SAVE_ALREADY_EXECUTED', 'CUA_SAVE_APPROVAL_EXPIRED', 'CUA_SAVE_NOT_VERIFIED',
  'CUA_SAVE_NOT_WRITTEN', 'CUA_SAVE_OUTCOME_UNKNOWN', 'CUA_UNAUTHORIZED_SENDER',
  'CUA_SCOPE_CHANGED', 'CUA_FRAME_STALE', 'CUA_FRAME_EXPIRED', 'CUA_STALE_FRAME',
  'CUA_TARGET_GONE', 'CUA_NOT_FOCUSED', 'CUA_CLEANUP_FAILED', 'CUA_APPROVAL_EXPIRED',
  'CUA_APPROVAL_MISMATCH', 'CUA_ACTION_REPLAYED', 'CUA_BUDGET_EXCEEDED', 'CUA_CANCELLED',
  'CUA_BUSY', 'CUA_EXPLICIT_SAVE_REQUIRED'
]);

export function isCuaSaveErrorCode(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_CODES.has(value);
}
export function normalizeCuaSaveError(error: unknown): string {
  const message = error instanceof Error ? error.message : error;
  return isCuaSaveErrorCode(message) ? message : 'CUA_SAVE_FAILED';
}
