import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CuaState } from '../src/shared/cua';
import {
  abortActiveTimelineDragSync,
  handleCuaStateRollbackAndAckSync,
  isActiveTimelineDragAborted,
  registerActiveTimelineDrag,
  resetCuaDragGuardForTests
} from '../src/renderer/src/cua/cuaDragGuard';
import { INITIAL_CUA_STATE } from '../src/renderer/src/cua/cuaSurfaceSnapshot';

afterEach(() => {
  resetCuaDragGuardForTests();
});

function makeState(overrides: Partial<CuaState> = {}): CuaState {
  return {
    ...INITIAL_CUA_STATE,
    sessionId: 'sess-1',
    runId: 'run-1',
    windowId: 1,
    ...overrides
  };
}

describe('cuaDragGuard', () => {
  it('rolls back an active timeline drag synchronously and marks drag aborted', () => {
    const rollback = vi.fn();
    registerActiveTimelineDrag(rollback);
    expect(isActiveTimelineDragAborted()).toBe(false);

    const rolledBack = abortActiveTimelineDragSync();
    expect(rolledBack).toBe(true);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(isActiveTimelineDragAborted()).toBe(true);

    // Repeating abort is a safe no-op.
    expect(abortActiveTimelineDragSync()).toBe(false);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('rolls back synchronously and acknowledges cancelToken exactly once per (runId, cancelToken)', () => {
    const rollback = vi.fn();
    const ackCancel = vi.fn(async () => ({ ok: true, value: { accepted: true } }));
    registerActiveTimelineDrag(rollback);

    const stopping = makeState({
      phase: 'stopping',
      runId: 'run-42',
      cancelToken: 'tok-abc',
      cleanupComplete: false
    });

    const first = handleCuaStateRollbackAndAckSync(stopping, ackCancel);
    expect(first).toEqual({ rolledBack: true, acked: true });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(isActiveTimelineDragAborted()).toBe(true);
    expect(ackCancel).toHaveBeenCalledTimes(1);
    expect(ackCancel).toHaveBeenCalledWith({ runId: 'run-42', cancelToken: 'tok-abc' });

    // Duplicate stopping push with same (runId, cancelToken) must not re-send ack.
    const dup = handleCuaStateRollbackAndAckSync(stopping, ackCancel);
    expect(dup).toEqual({ rolledBack: false, acked: false });
    expect(ackCancel).toHaveBeenCalledTimes(1);

    // New cancelToken in a later cancellation is acknowledged.
    const nextStopping = makeState({
      phase: 'stopping',
      runId: 'run-42',
      cancelToken: 'tok-def',
      cleanupComplete: false
    });
    const second = handleCuaStateRollbackAndAckSync(nextStopping, ackCancel);
    expect(second).toEqual({ rolledBack: false, acked: true });
    expect(ackCancel).toHaveBeenCalledTimes(2);
    expect(ackCancel).toHaveBeenLastCalledWith({ runId: 'run-42', cancelToken: 'tok-def' });
  });

  it('rolls back on stopped and cleanup-failed without calling ackCancel', () => {
    const rollback = vi.fn();
    const ackCancel = vi.fn(async () => ({ ok: true, value: { accepted: true } }));
    registerActiveTimelineDrag(rollback);

    const res = handleCuaStateRollbackAndAckSync(
      makeState({ phase: 'cleanup-failed', cancelToken: null, releaseFailures: ['renderer-rollback-unconfirmed'] }),
      ackCancel
    );
    expect(res).toEqual({ rolledBack: true, acked: false });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(ackCancel).not.toHaveBeenCalled();
  });
});
