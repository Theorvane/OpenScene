import { describe, expect, it } from 'vitest';
import { CuaAgentOrchestrator, CuaApprovalAuthority, type CuaAgentDriver } from '../src/main/cuaAgentOrchestration';
import type { CuaActionRequest, CuaFrame, CuaState } from '../src/shared/cua';

function fixture() {
  let state: CuaState = { sessionId: null, runId: null, windowId: 7, phase: 'idle', cursor: null,
    dragStart: null, target: null, label: null, error: null, cleanupComplete: true, releaseFailures: [] };
  let frameNumber = 0;
  let inputs = 0;
  let cancellations = 0;
  let blocked = true;
  const aborted: string[] = [];
  const authority = new CuaApprovalAuthority({ permitTtlMs: 100, maxActionsPerRun: 2, now: () => 0 });
  const driver: CuaAgentDriver = {
    observe: async (scope) => {
      state = { ...state, ...scope, phase: 'ready' };
      return { ...scope, windowId: 7, frameId: `frame-${++frameNumber}`, layoutRevision: 1, capturedAt: 0,
        viewport: { width: 100, height: 100 }, bitmap: { width: 100, height: 100 }, deviceScaleFactor: 1,
        zoomFactor: 1, pngDataUrl: 'data:image/png;base64,AAAA' };
    },
    execute: async (request, permit) => {
      expect(blocked).toBe(false);
      authority.consume(request, permit);
      inputs++;
      return state;
    },
    getState: () => state,
    cancel: async () => { cancellations++; state = { ...state, phase: 'stopped' }; return state; },
    setExecutionBlocked: (value) => { blocked = value; }
  };
  const orchestrator = new CuaAgentOrchestrator(authority, { driver, onAbortConversation: (id) => { aborted.push(id); } });
  const requestFor = (frame: CuaFrame): CuaActionRequest => ({ sessionId: frame.sessionId, runId: frame.runId,
    windowId: frame.windowId, frameId: frame.frameId, layoutRevision: frame.layoutRevision, action: { kind: 'click', point: { x: 10, y: 20 } } });
  return { authority, driver, orchestrator, aborted, requestFor, inputs: () => inputs,
    cancellations: () => cancellations, blocked: () => blocked };
}

describe('CUA immutable run binding and dispatch', () => {
  it('preserves the original frame through prompt replay and runs the approved action once', async () => {
    const f = fixture();
    const observed = await f.orchestrator.observe('a');
    const request = f.requestFor(observed.frame);
    const summary = f.orchestrator.prepareApproval('a', 'one', request);
    expect(f.orchestrator.prepareApproval('a', 'one', request)).toEqual(summary);
    expect(f.authority.getPendingApproval()?.runId).toBe(observed.frame.runId);
    await f.orchestrator.executeApproved('a', 'one', request);
    expect(f.inputs()).toBe(1);
    expect(f.blocked()).toBe(true);
    await expect(f.orchestrator.executeApproved('a', 'one', request)).rejects.toThrow();
    expect(f.inputs()).toBe(1);
  });

  it('refuses a newly observed frame to inherit an old approval', async () => {
    const f = fixture();
    const first = await f.orchestrator.observe('a');
    const second = await f.orchestrator.observe('a');
    expect(second.frame.frameId).not.toBe(first.frame.frameId);
    expect(() => f.orchestrator.prepareApproval('a', 'one', f.requestFor(first.frame))).toThrow('CUA_FRAME_STALE');
    expect(f.inputs()).toBe(0);
  });

  it('cannot cancel the active run through another conversation ID', async () => {
    const f = fixture();
    await f.orchestrator.observe('a');
    await f.orchestrator.cancelConversation('b');
    expect(f.cancellations()).toBe(0);
    expect(f.aborted).toEqual([]);
  });

  it('shares cancellation settlement, revokes first and removes the old run binding', async () => {
    const f = fixture();
    const old = await f.orchestrator.observe('a');
    const request = f.requestFor(old.frame);
    f.orchestrator.prepareApproval('a', 'one', request);
    const cancelled = f.orchestrator.cancelConversation('a');
    expect(f.orchestrator.cancelConversation('a')).toBe(cancelled);
    expect(f.authority.getPendingApproval()).toBeNull();
    expect(f.aborted).toEqual(['a']);
    await cancelled;
    const next = await f.orchestrator.observe('b');
    expect(next.frame.runId).not.toBe(old.frame.runId);
    f.orchestrator.abortRun(old.frame.runId);
    expect(f.aborted).toEqual(['a']);
    f.orchestrator.prepareApproval('b', 'new', f.requestFor(next.frame));
  });

  it('settles a trusted external stop without keeping a dead conversation binding', async () => {
    const f = fixture();
    const old = await f.orchestrator.observe('a');
    f.orchestrator.abortRun(old.frame.runId);
    f.orchestrator.settleRun({ ...f.driver.getState(), phase: 'stopped' });
    const next = await f.orchestrator.observe('b');
    expect(next.frame.runId).not.toBe(old.frame.runId);
    f.orchestrator.abortRun(old.frame.runId);
    expect(f.aborted.every((id) => id === 'a')).toBe(true);
  });

  it('denial leaves main execution blocked and provides no permit', async () => {
    const f = fixture();
    const frame = (await f.orchestrator.observe('a')).frame;
    const request = f.requestFor(frame);
    f.orchestrator.prepareApproval('a', 'one', request);
    f.orchestrator.deny('a', 'one');
    expect(f.blocked()).toBe(true);
    await expect(f.orchestrator.executeApproved('a', 'one', request)).rejects.toThrow('CUA_APPROVAL_MISMATCH');
    expect(f.inputs()).toBe(0);
  });
});
