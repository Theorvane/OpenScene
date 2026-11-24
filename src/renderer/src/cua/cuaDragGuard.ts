import type { CuaCancelAck, CuaState } from '../../../shared/cua';

type DragRollbackHandler = () => void;

const MAX_ACKED_TOKENS = 64;

let activeDragRollback: DragRollbackHandler | null = null;
let dragAborted = false;
const ackedCancelKeys = new Set<string>();

/**
 * Registers the currently active timeline pointer drag so a renderer-initiated
 * Stop or main-process `stopping` push can roll it back synchronously before
 * the driver's synthetic `mouseUp` arrives.
 */
export function registerActiveTimelineDrag(rollback: DragRollbackHandler): () => void {
  dragAborted = false;
  activeDragRollback = rollback;
  return () => {
    if (activeDragRollback === rollback) {
      activeDragRollback = null;
    }
  };
}

/**
 * Synchronously checks whether the current timeline pointer drag was aborted
 * by a CUA stop/cancel signal. Must be checked inside `pointerup` before
 * committing any timeline mutation or pushing to the Undo stack.
 */
export function isActiveTimelineDragAborted(): boolean {
  return dragAborted;
}

/**
 * Synchronously aborts and rolls back any active timeline pointer drag
 * (clearing preview state and releasing pointer capture) without waiting for
 * a React render.
 */
export function abortActiveTimelineDragSync(): boolean {
  dragAborted = true;
  const rollback = activeDragRollback;
  if (rollback === null) return false;
  activeDragRollback = null;
  try {
    rollback();
  } catch {
    // Rollback must never throw across IPC/event boundaries.
  }
  return true;
}

/**
 * Called at the very top of `onCuaStateChanged`, strictly BEFORE React
 * `setState`. Performs synchronous drag rollback on `stopping`, `stopped`, or
 * `cleanup-failed`, and immediately acknowledges `cancelToken` via
 * `cuaAckCancel` (deduplicated per `(runId, cancelToken)`).
 */
export function handleCuaStateRollbackAndAckSync(
  state: CuaState,
  ackCancel?: (ack: CuaCancelAck) => Promise<unknown>
): { readonly rolledBack: boolean; readonly acked: boolean } {
  if (state.phase === 'stopping' || state.phase === 'stopped' || state.phase === 'cleanup-failed') {
    const rolledBack = abortActiveTimelineDragSync();
    let acked = false;
    if (state.phase === 'stopping' && state.cancelToken !== null && state.runId !== null) {
      const key = `${state.runId}:${state.cancelToken}`;
      if (!ackedCancelKeys.has(key)) {
        if (ackedCancelKeys.size >= MAX_ACKED_TOKENS) {
          const oldest = ackedCancelKeys.values().next().value;
          if (oldest !== undefined) ackedCancelKeys.delete(oldest);
        }
        ackedCancelKeys.add(key);
        acked = true;
        if (typeof ackCancel === 'function') {
          void ackCancel({ runId: state.runId, cancelToken: state.cancelToken }).catch(() => undefined);
        }
      }
    }
    return { rolledBack, acked };
  }

  if (activeDragRollback === null) {
    dragAborted = false;
  }
  return { rolledBack: false, acked: false };
}

/** Test-only helper to clear module-level drag guard state between unit tests. */
export function resetCuaDragGuardForTests(): void {
  activeDragRollback = null;
  dragAborted = false;
  ackedCancelKeys.clear();
}
