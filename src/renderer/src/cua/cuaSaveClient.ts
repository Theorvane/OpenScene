import type {
  CuaSaveCommitAck,
  CuaSaveReadyAck,
  CuaSaveReadyRequest,
  CuaSaveResult,
  CuaSaveSnapshotReport,
  CuaSaveSnapshotRequest
} from '../../../shared/cuaSave';
import type { LocalProjectSnapshot } from '../../../shared/timelineTypes';

export interface LiveEditorSaveState {
  readonly project: Pick<LocalProjectSnapshot, 'id' | 'timeline'> | null;
  readonly contentRevision: number;
  readonly hasUnsavedTimeline: boolean;
  readonly isSavingTimeline: boolean;
  readonly cuaSaveFreezeToken: string | null;
  readonly hasActiveDrag: boolean;
}

/**
 * Builds a read-only live timeline snapshot report for main's CuaSaveBridge.
 * Never mutates editor state or triggers disk writes; returns null if the
 * requested scope does not match the live editor or edits/saves are in flight.
 */
export function buildCuaSaveSnapshotReport(
  request: CuaSaveSnapshotRequest,
  state: LiveEditorSaveState
): CuaSaveSnapshotReport | null {
  if (
    state.project === null ||
    state.project.id !== request.scope.projectId ||
    state.contentRevision !== request.scope.contentRevision ||
    state.isSavingTimeline ||
    state.cuaSaveFreezeToken !== null ||
    state.hasActiveDrag
  ) {
    return null;
  }

  return {
    requestToken: request.requestToken,
    runId: request.scope.runId,
    projectId: state.project.id,
    contentRevision: state.contentRevision,
    dirty: state.hasUnsavedTimeline,
    timeline: structuredClone(state.project.timeline)
  };
}

/**
 * Evaluates main's pre-publication freeze request (`onCuaSaveRequested`).
 * Only freezes and replies `ready: true` when projectId and contentRevision
 * match the approved proposal and no manual save, freeze, or drag is active.
 * Always emits exact public protocol error codes when refusing.
 */
export function evaluateCuaSaveReadyRequest(
  request: CuaSaveReadyRequest,
  state: LiveEditorSaveState
): { readonly freezeToken: string | null; readonly ack: CuaSaveReadyAck } {
  const { proposal, saveToken } = request;
  const baseAck = {
    saveToken,
    runId: proposal.scope.runId,
    projectId: proposal.scope.projectId,
    contentRevision: proposal.scope.contentRevision,
    snapshotId: proposal.snapshotId,
    timelineDigest: proposal.timelineDigest
  };

  if (
    state.project === null ||
    state.project.id !== proposal.scope.projectId ||
    state.contentRevision !== proposal.scope.contentRevision
  ) {
    return {
      freezeToken: null,
      ack: { ...baseAck, ready: false, errorCode: 'CUA_SAVE_SCOPE_CHANGED' }
    };
  }

  if (
    state.isSavingTimeline ||
    (state.cuaSaveFreezeToken !== null && state.cuaSaveFreezeToken !== saveToken)
  ) {
    return {
      freezeToken: null,
      ack: { ...baseAck, ready: false, errorCode: 'CUA_SAVE_BUSY' }
    };
  }

  if (state.hasActiveDrag) {
    return {
      freezeToken: null,
      ack: { ...baseAck, ready: false, errorCode: 'CUA_SAVE_RENDERER_NOT_READY' }
    };
  }

  return {
    freezeToken: saveToken,
    ack: { ...baseAck, ready: true }
  };
}

/**
 * Evaluates main's terminal Save outcome (`onCuaSaveFinished`).
 * - Always releases the active freeze for this save token (even on failure).
 * - Applies clean UI state (`dirty=false`) ONLY when main persisted/verified
 *   matching disk bytes (`diskMatches === true`) AND the live editor still
 *   matches `projectId` and `expectedContentRevision`.
 */
export function evaluateCuaSaveFinished(
  result: CuaSaveResult,
  state: LiveEditorSaveState
): {
  readonly releaseFreeze: boolean;
  readonly applyCleanUi: boolean;
  readonly saveError: string | null;
  readonly commitAck: CuaSaveCommitAck | null;
} {
  const releaseFreeze =
    state.cuaSaveFreezeToken === null || state.cuaSaveFreezeToken === result.saveToken;

  const written =
    result.status === 'persisted' ||
    result.status === 'persisted-after-cancel' ||
    result.status === 'already-clean';

  const sameLiveRevision =
    state.project !== null &&
    state.project.id === result.projectId &&
    state.contentRevision === result.expectedContentRevision;

  const applyCleanUi = written && result.diskMatches === true && sameLiveRevision;

  let saveError: string | null = null;
  if (!applyCleanUi) {
    if (result.status === 'write-outcome-unknown') {
      saveError = result.errorCode ?? 'CUA_SAVE_OUTCOME_UNKNOWN';
    } else if (written && result.diskMatches !== true) {
      saveError = result.errorCode ?? 'CUA_SAVE_NOT_VERIFIED';
    }
  }

  const commitAck: CuaSaveCommitAck | null = written
    ? {
        saveToken: result.saveToken,
        runId: result.runId,
        projectId: result.projectId,
        contentRevision: result.expectedContentRevision,
        uiApplied: applyCleanUi
      }
    : null;

  return { releaseFreeze, applyCleanUi, saveError, commitAck };
}
