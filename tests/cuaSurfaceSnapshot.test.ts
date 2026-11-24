import { describe, expect, it } from 'vitest';

import {
  CuaSurfaceRevisionTracker,
  buildSurfaceRevisionKey,
  clipRectToViewport,
  computeWorkspaceInert,
  createFailClosedSnapshot,
  excludeProtectedFromSafeSurface,
  rectContains,
  type CuaProtectedRectEntry,
  type MeasuredSurfaceState
} from '../src/renderer/src/cua/cuaSurfaceSnapshot';

function makeMeasured(overrides: Partial<MeasuredSurfaceState> = {}): MeasuredSurfaceState {
  const agentPanel: CuaProtectedRectEntry = {
    id: 'agent-chat-panel',
    kind: 'agent-panel',
    rect: { x: 1040, y: 40, width: 360, height: 860 }
  };
  const chrome: CuaProtectedRectEntry = {
    id: 'product-chrome',
    kind: 'chrome-menu',
    rect: { x: 0, y: 0, width: 1400, height: 40 }
  };
  return {
    viewport: { width: 1400, height: 900 },
    safeSurface: {
      kind: 'timeline',
      rect: { x: 0, y: 480, width: 1032, height: 420 },
      interactive: true
    },
    protectedRects: [chrome, agentPanel],
    focusedInSafeSurface: false,
    focusedTestId: null,
    scrollStates: [{ id: 'timeline-stack', scrollLeft: 0, scrollTop: 0 }],
    hasBlockingOverlay: false,
    ...overrides
  };
}

describe('cuaSurfaceSnapshot', () => {
  it('starts fail-closed with safeSurface: null and produces fail-closed snapshots on unmount', () => {
    const initial = createFailClosedSnapshot(0);
    expect(initial.safeSurface).toBeNull();
    expect(initial.focusedInSafeSurface).toBe(false);
    expect(initial.focusedTestId).toBeNull();

    const tracker = new CuaSurfaceRevisionTracker();
    const first = tracker.failClosed({ width: 1400, height: 900 });
    expect(first.layoutRevision).toBe(1);
    expect(first.safeSurface).toBeNull();

    const mounted = tracker.next(makeMeasured());
    expect(mounted.revisionChanged).toBe(true);
    expect(mounted.snapshot.layoutRevision).toBe(2);
    expect(mounted.snapshot.safeSurface?.kind).toBe('timeline');

    const unmounted = tracker.failClosed({ width: 1400, height: 900 });
    expect(unmounted.layoutRevision).toBe(3);
    expect(unmounted.safeSurface).toBeNull();
  });

  it('keeps layoutRevision unchanged when an approval card opens inside a fixed-width non-overlapping AgentChatPanel', () => {
    const tracker = new CuaSurfaceRevisionTracker();
    const base = tracker.next(makeMeasured());
    expect(base.snapshot.layoutRevision).toBe(1);

    const approvalInsideChat: CuaProtectedRectEntry = {
      id: 'agent-chat-approval',
      kind: 'approval-ui',
      rect: { x: 1056, y: 320, width: 328, height: 220 }
    };

    const withApproval = tracker.next(
      makeMeasured({
        safeSurface: {
          kind: 'timeline',
          rect: { x: 0, y: 480, width: 1032, height: 420 },
          interactive: false
        },
        protectedRects: [...makeMeasured().protectedRects, approvalInsideChat],
        focusedInSafeSurface: false,
        focusedTestId: 'approve-btn-ignored-outside-safe'
      })
    );

    expect(withApproval.revisionChanged).toBe(false);
    expect(withApproval.snapshot.layoutRevision).toBe(1);
    expect(withApproval.snapshot.protectedRects.some((r) => r.kind === 'approval-ui')).toBe(true);
    expect(withApproval.snapshot.focusedTestId).toBeNull();
    // Delivery still notifies backend of updated interactive/protectedRects state.
    expect(withApproval.changed).toBe(true);
  });

  it('immediately increments layoutRevision when AgentChatPanel resizes or approval-ui overlaps safeSurface', () => {
    const tracker = new CuaSurfaceRevisionTracker();
    const r1 = tracker.next(makeMeasured());
    expect(r1.snapshot.layoutRevision).toBe(1);

    // Resizing AgentChatPanel changes both agent-panel and safeSurface rects.
    const r2 = tracker.next(
      makeMeasured({
        safeSurface: {
          kind: 'timeline',
          rect: { x: 0, y: 480, width: 972, height: 420 },
          interactive: true
        },
        protectedRects: [
          { id: 'product-chrome', kind: 'chrome-menu', rect: { x: 0, y: 0, width: 1400, height: 40 } },
          { id: 'agent-chat-panel', kind: 'agent-panel', rect: { x: 980, y: 40, width: 420, height: 860 } }
        ]
      })
    );
    expect(r2.revisionChanged).toBe(true);
    expect(r2.snapshot.layoutRevision).toBe(2);

    // Floating approval-ui overlapping outside agent-panel bumps layoutRevision.
    const floatingApproval: CuaProtectedRectEntry = {
      id: 'floating-approval',
      kind: 'approval-ui',
      rect: { x: 700, y: 500, width: 320, height: 200 }
    };
    const r3 = tracker.next(
      makeMeasured({
        safeSurface: {
          kind: 'timeline',
          rect: { x: 0, y: 480, width: 972, height: 420 },
          interactive: true
        },
        protectedRects: [
          { id: 'product-chrome', kind: 'chrome-menu', rect: { x: 0, y: 0, width: 1400, height: 40 } },
          { id: 'agent-chat-panel', kind: 'agent-panel', rect: { x: 980, y: 40, width: 420, height: 860 } },
          floatingApproval
        ]
      })
    );
    expect(r3.revisionChanged).toBe(true);
    expect(r3.snapshot.layoutRevision).toBe(3);
  });

  it('increments layoutRevision on scroll, view switch, modal open/close, and safe focus changes', () => {
    const tracker = new CuaSurfaceRevisionTracker();
    expect(tracker.next(makeMeasured()).snapshot.layoutRevision).toBe(1);

    // Timeline scroll
    expect(
      tracker.next(makeMeasured({ scrollStates: [{ id: 'timeline-stack', scrollLeft: 180, scrollTop: 0 }] })).snapshot.layoutRevision
    ).toBe(2);

    // Safe focus enters clip
    const focused = tracker.next(
      makeMeasured({
        scrollStates: [{ id: 'timeline-stack', scrollLeft: 180, scrollTop: 0 }],
        focusedInSafeSurface: true,
        focusedTestId: 'timeline-clip-clip-1'
      })
    );
    expect(focused.snapshot.layoutRevision).toBe(3);
    expect(focused.snapshot.focusedTestId).toBe('timeline-clip-clip-1');

    // View switch to canvas
    expect(
      tracker.next(
        makeMeasured({
          safeSurface: { kind: 'canvas', rect: { x: 0, y: 90, width: 1032, height: 810 }, interactive: true },
          scrollStates: [{ id: 'video-canvas__scroll', scrollLeft: 0, scrollTop: 0 }],
          focusedInSafeSurface: false,
          focusedTestId: null
        })
      ).snapshot.layoutRevision
    ).toBe(4);

    // Modal opens -> fail-closed safeSurface: null
    const withModal = tracker.next(
      makeMeasured({
        safeSurface: null,
        hasBlockingOverlay: true,
        protectedRects: [
          ...makeMeasured().protectedRects,
          { id: 'project-settings-dialog', kind: 'modal', rect: { x: 400, y: 200, width: 600, height: 500 } }
        ]
      })
    );
    expect(withModal.snapshot.layoutRevision).toBe(5);
    expect(withModal.snapshot.safeSurface).toBeNull();
  });

  it('excludes overlapping protected panels and returns null when modals or settings are visible', () => {
    const candidate = { x: 0, y: 0, width: 1400, height: 900 };
    const trimmed = excludeProtectedFromSafeSurface(candidate, [
      { id: 'chrome', kind: 'chrome-menu', rect: { x: 0, y: 0, width: 1400, height: 40 } },
      { id: 'chat', kind: 'agent-panel', rect: { x: 1040, y: 40, width: 360, height: 860 } }
    ]);
    expect(trimmed).toEqual({ x: 0, y: 40, width: 1040, height: 860 });

    const blockedByModal = excludeProtectedFromSafeSurface(candidate, [
      { id: 'dialog', kind: 'modal', rect: { x: 300, y: 200, width: 500, height: 400 } }
    ]);
    expect(blockedByModal).toBeNull();

    const blockedBySettings = excludeProtectedFromSafeSurface(candidate, [
      { id: 'settings-page', kind: 'settings', rect: { x: 0, y: 40, width: 1400, height: 860 } }
    ]);
    expect(blockedBySettings).toBeNull();

    expect(clipRectToViewport({ x: -20, y: 10, width: 100, height: 50 }, { width: 1000, height: 600 })).toEqual({
      x: 0,
      y: 10,
      width: 80,
      height: 50
    });
    expect(rectContains({ x: 1000, y: 0, width: 400, height: 900 }, { x: 1020, y: 100, width: 360, height: 200 })).toBe(true);
    expect(buildSurfaceRevisionKey(makeMeasured())).toBe(buildSurfaceRevisionKey(makeMeasured()));
  });

  it('coordinates workspace inertness across pendingApproval, CUA acting, and normal agent turns', () => {
    // Pending approval keeps workspace inert while waiting for the user's decision.
    expect(computeWorkspaceInert({ isAgentBusy: false, hasPendingApproval: true, cuaPhase: 'idle' })).toBe(true);
    expect(computeWorkspaceInert({ isAgentBusy: false, hasPendingApproval: true, cuaPhase: 'ready' })).toBe(true);

    // CUA acting unlocks workspace so webContents.sendInputEvent can reach the timeline,
    // even while agentChatApprove is in flight (isAgentBusy: true, pendingApproval still set).
    expect(computeWorkspaceInert({ isAgentBusy: true, hasPendingApproval: false, cuaPhase: 'acting' })).toBe(false);
    expect(computeWorkspaceInert({ isAgentBusy: true, hasPendingApproval: true, cuaPhase: 'acting' })).toBe(false);

    // Non-acting busy agent turn keeps workspace inert.
    expect(computeWorkspaceInert({ isAgentBusy: true, hasPendingApproval: false, cuaPhase: 'idle' })).toBe(true);
    expect(computeWorkspaceInert({ isAgentBusy: true, hasPendingApproval: false, cuaPhase: 'ready' })).toBe(true);
    expect(computeWorkspaceInert({ isAgentBusy: true, hasPendingApproval: false, cuaPhase: 'stopping' })).toBe(true);

    // Idle without pending approval is unlocked.
    expect(computeWorkspaceInert({ isAgentBusy: false, hasPendingApproval: false, cuaPhase: 'idle' })).toBe(false);
    expect(computeWorkspaceInert({ isAgentBusy: false, hasPendingApproval: false, cuaPhase: 'stopped' })).toBe(false);
  });
});
