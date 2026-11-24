import { describe, expect, it, vi } from 'vitest';
import { CuaAgentOrchestrator, CuaApprovalAuthority, type CuaAgentDriver } from '../src/main/cuaAgentOrchestration';
import type { CuaFrame, CuaState } from '../src/shared/cua';

function fixture() {
  let frame!: CuaFrame;
  const state: CuaState = { sessionId: null, runId: null, windowId: 7, phase: 'ready', prepareToken: null, cancelToken: null,
    targetGone: false, cursor: null, dragStart: null, target: null, label: null, error: null, cleanupComplete: true, releaseFailures: [] };
  const driver: CuaAgentDriver = {
    observe: vi.fn(async scope => {
      frame = { ...scope, windowId: 7, frameId: 'f', layoutRevision: 2, contentRevision: 3, capturedAt: 100,
        bitmap: { width: 20, height: 20 }, viewport: { width: 20, height: 20 }, deviceScaleFactor: 1, zoomFactor: 1, pngDataUrl: 'data:image/png;base64,AAAA' };
      return frame;
    }), execute: async () => state, cancel: async () => state, getState: () => state, setExecutionBlocked: () => undefined
  };
  const authority = new CuaApprovalAuthority({ permitTtlMs: 100, maxActionsPerRun: 2, now: () => 0 });
  return { driver, authority, orchestrator: new CuaAgentOrchestrator(authority, { driver, onAbortConversation: () => undefined }), frame: () => frame };
}
describe('main-only Jev observation binding', () => {
  it('returns only frozen cloned metadata and the trusted run signal', async () => {
    const f = fixture(); expect(f.orchestrator.getObservationBinding('c')).toBeNull();
    await f.orchestrator.observe('c');
    const binding = f.orchestrator.getObservationBinding('c')!;
    expect(binding.frame).not.toHaveProperty('pngDataUrl');
    expect(binding.frame.frameId).toBe('f'); expect(binding.signal.aborted).toBe(false);
    expect(Object.isFrozen(binding.frame)).toBe(true); expect(Object.isFrozen(binding.frame.viewport)).toBe(true);
    Object.assign(f.frame().viewport, { width: 999 });
    expect(f.orchestrator.getObservationBinding('c')?.frame.viewport.width).toBe(20);
    expect(f.orchestrator.getObservationBinding('other')).toBeNull();
  });
  it('refuses pending approval and revoked runs without changing authority', async () => {
    const f = fixture(); await f.orchestrator.observe('c'); const frame = f.frame();
    const binding = f.orchestrator.getObservationBinding('c')!;
    f.orchestrator.prepareApproval('c', 'call', { ...frame, action: { kind: 'click', point: { x: 1, y: 1 } } });
    expect(f.orchestrator.getObservationBinding('c')).toBeNull();
    f.orchestrator.deny('c', 'call'); expect(f.orchestrator.getObservationBinding('c')).not.toBeNull();
    f.orchestrator.abortRun(frame.runId); expect(binding.signal.aborted).toBe(true);
    expect(f.orchestrator.getObservationBinding('c')).toBeNull();
  });
  it('refuses readback during observation and after cleanup failure', async () => {
    const f = fixture(); await f.orchestrator.observe('c');
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const observe = f.driver.observe; f.driver.observe = async scope => { await wait; return observe(scope); };
    const pending = f.orchestrator.observe('c'); expect(f.orchestrator.getObservationBinding('c')).toBeNull();
    release(); await pending; f.authority.recordCleanupFailure();
    expect(f.orchestrator.getObservationBinding('c')).toBeNull();
  });
});
