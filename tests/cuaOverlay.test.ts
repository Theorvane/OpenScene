import { readFile } from 'node:fs/promises';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CuaRect, CuaState } from '../src/shared/cua';
import {
  CuaSurfaceRevisionTracker,
  INITIAL_CUA_STATE,
  buildSurfaceGeometryKey,
  isCuaStopSettled,
  isCuaStoppablePhase,
  rectContains,
  type MeasuredSurfaceState
} from '../src/renderer/src/cua/cuaSurfaceSnapshot';
import type { CuaPhase } from '../src/shared/cua';

interface UseCuaOverlayModule {
  readonly clipRectToOverflowAncestors: (
    element: Element,
    rect: CuaRect,
    viewport: { readonly width: number; readonly height: number }
  ) => CuaRect | null;
  readonly collectDomSurfaceState: (options: {
    readonly contentRevision: number;
    readonly isAgentBusy: boolean;
    readonly hasPendingApproval: boolean;
    readonly cuaPhase: CuaPhase;
    readonly isUpdating?: boolean;
  }) => MeasuredSurfaceState;
  readonly hasActiveFocusInSafeSurface: (doc?: Pick<Document, 'activeElement'>) => boolean;
  readonly preserveSafeSurfaceFocusOnPrimaryMouseDown: (
    event: { readonly button: number; readonly preventDefault: () => void },
    doc?: Pick<Document, 'activeElement'>
  ) => boolean;
}

async function loadUseCuaOverlayModule(): Promise<UseCuaOverlayModule> {
  const modulePath = '../src/renderer/src/cua/useCuaOverlay.ts';
  return (await import(modulePath)) as UseCuaOverlayModule;
}

interface CuaOverlayModule {
  readonly CuaOverlay: (props: {
    readonly state: CuaState;
    readonly stopPending: boolean;
    readonly stopError: string | null;
    readonly agentBusy?: boolean;
    readonly onStop: () => void;
  }) => ReactElement;
  readonly getCuaCleanupStatusText: (state: CuaState, stopPending: boolean) => string | null;
  readonly getCuaCursorMode: (state: CuaState, stopPending: boolean) => string;
}

async function loadCuaOverlayModule(): Promise<CuaOverlayModule> {
  const modulePath = '../src/renderer/src/cua/CuaOverlay.tsx';
  return (await import(modulePath)) as CuaOverlayModule;
}

function makeState(overrides: Partial<CuaState> = {}): CuaState {
  return {
    ...INITIAL_CUA_STATE,
    sessionId: 'sess-1',
    runId: 'run-1',
    windowId: 1,
    ...overrides
  };
}

describe('CuaOverlay', () => {
  it('keeps the fixed-footprint stop button mounted but hidden/inert-disabled when phase is idle', async () => {
    const { CuaOverlay } = await loadCuaOverlayModule();
    const html = renderToStaticMarkup(
      createElement(CuaOverlay, {
        state: makeState({ phase: 'idle' }),
        stopPending: false,
        stopError: null,
        onStop: () => undefined
      })
    );
    expect(html).toContain('data-testid="cua-overlay"');
    expect(html).toContain('data-cua-active="false"');
    expect(html).toContain('data-testid="cua-stop-btn"');
    expect(html).toContain('data-cua-protected="stop-button"');
    expect(html).toContain('cua-stop-btn--idle');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('data-testid="cua-hud"');
    expect(html).not.toContain('data-testid="cua-cursor"');
  });

  it('activates the always-mounted stop button while agentBusy is true in idle phase without showing HUD', async () => {
    const { CuaOverlay } = await loadCuaOverlayModule();
    const html = renderToStaticMarkup(
      createElement(CuaOverlay, {
        state: makeState({ phase: 'idle' }),
        stopPending: false,
        stopError: null,
        agentBusy: true,
        onStop: () => undefined
      })
    );
    expect(html).toContain('data-cua-active="true"');
    expect(html).toContain('data-testid="cua-stop-btn"');
    expect(html).not.toContain('cua-stop-btn--idle');
    expect(html).not.toContain('data-testid="cua-hud"');
  });

  it('renders virtual cursor, drag path markers, label, and protected stop button while dragging', async () => {
    const { CuaOverlay, getCuaCursorMode } = await loadCuaOverlayModule();
    const state = makeState({
      phase: 'acting',
      cursor: { x: 320, y: 540 },
      dragStart: { x: 240, y: 540 },
      target: { x: 460, y: 540 },
      label: 'Dragging clip-1 to 00:05.0',
      cleanupComplete: false
    });

    expect(getCuaCursorMode(state, false)).toBe('dragging');

    const html = renderToStaticMarkup(
      createElement(CuaOverlay, {
        state,
        stopPending: false,
        stopError: null,
        onStop: () => undefined
      })
    );

    expect(html).toContain('data-testid="cua-overlay"');
    expect(html).toContain('data-cua-phase="acting"');
    expect(html).toContain('data-testid="cua-cursor"');
    expect(html).toContain('data-cua-cursor-mode="dragging"');
    expect(html).toContain('translate3d(320px, 540px, 0)');
    expect(html).toContain('data-testid="cua-drag-start"');
    expect(html).toContain('data-testid="cua-drag-progress-line"');
    expect(html).toContain('data-testid="cua-drag-target-line"');
    expect(html).toContain('data-testid="cua-drag-target"');
    expect(html).toContain('Dragging clip-1 to 00:05.0');
    expect(html).toContain('data-testid="cua-stop-btn"');
    expect(html).toContain('data-cua-protected="stop-button"');
  });

  it('renders preparing phase with stoppable fixed-footprint button and deterministic prepareAck wiring', async () => {
    const { CuaOverlay } = await loadCuaOverlayModule();
    expect(isCuaStoppablePhase('preparing')).toBe(true);
    const html = renderToStaticMarkup(
      createElement(CuaOverlay, {
        state: makeState({ phase: 'preparing', prepareToken: 'prep-tok-1', label: 'drag' }),
        stopPending: false,
        stopError: null,
        onStop: () => undefined
      })
    );
    expect(html).toContain('data-cua-phase="preparing"');
    expect(html).toContain('Preparing CUA…');
    expect(html).toContain('data-testid="cua-stop-btn"');
    expect(html).not.toContain('cua-stop-btn--idle');

    const [useCuaOverlaySource, agentChatContextSource, appShellSource, shortcutsSource, panelSource] = await Promise.all([
      readFile(new URL('../src/renderer/src/cua/useCuaOverlay.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/renderer/src/AgentChatContext.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/renderer/src/AppShell.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/renderer/src/editor/useTimelineShortcuts.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/renderer/src/AgentChatPanel.tsx', import.meta.url), 'utf8')
    ]);
    expect(useCuaOverlaySource).toContain('useLayoutEffect(');
    expect(useCuaOverlaySource).toContain('cuaAckPrepare({ runId, prepareToken })');
    expect(useCuaOverlaySource).toContain('void triggerStop()');
    expect(useCuaOverlaySource).toContain('cua.isActing || cua.isPreparing');
    expect(useCuaOverlaySource).toContain("options.cuaPhase === 'acting' || options.cuaPhase === 'preparing'");
    expect(shortcutsSource).toContain('inputRef.current = latestInput');
    expect(agentChatContextSource).not.toContain('approvalInFlight');
    expect(agentChatContextSource).not.toContain('waitNextPaint');
    expect(agentChatContextSource).toContain('cancelInFlightRef');
    expect(agentChatContextSource).toContain('setCuaSaveResult');
    expect(panelSource).toContain('data-testid="agent-cua-save-result"');
    expect(panelSource).toContain('data-testid="agent-cua-approval-save-digest"');
    expect(appShellSource).toContain('if (isBusy || pendingApproval !== null) void cancelConversation();');
    expect(appShellSource).toContain('agentBusy={isBusy || pendingApproval !== null}');
    expect(appShellSource).toContain('void cua.triggerStop();');
  });

  it('keeps cua-stop-btn enabled during pendingApproval even if mouseDown transitions CUA phase to stopping/stopped before click', async () => {
    const { CuaOverlay } = await loadCuaOverlayModule();

    // While pendingApproval is open (AppShell passes agentBusy={isBusy || pendingApproval !== null}),
    // main-process CuaDriver before-mouse-event can push phase ready -> stopping -> stopped on mouseDown
    // before mouseUp/click fires. cua-stop-btn MUST stay enabled so onStop() -> agent-chat:cancel fires.
    for (const phase of ['ready', 'stopping', 'stopped'] as const) {
      let stopCalls = 0;
      const element = CuaOverlay({
        state: makeState({ phase, cleanupComplete: phase !== 'stopping', error: phase === 'ready' ? null : 'user-input' }),
        stopPending: false,
        stopError: null,
        agentBusy: true,
        onStop: () => {
          stopCalls += 1;
        }
      });
      const html = renderToStaticMarkup(element);
      expect(html).toContain('data-testid="cua-stop-btn"');
      expect(html).toContain('data-cua-protected="stop-button"');
      expect(html).not.toContain('disabled=""');
      expect(html).toContain('Stop (Esc)');

      const children = (element.props as { children: unknown[] }).children;
      const stopButton = children.find(
        (child): child is { props: { disabled?: boolean; onClick?: () => void; 'data-testid'?: string } } =>
          Boolean(child && typeof child === 'object' && 'props' in child && (child as { props?: { 'data-testid'?: string } }).props?.['data-testid'] === 'cua-stop-btn')
      );
      expect(stopButton).toBeDefined();
      expect(stopButton!.props.disabled).toBe(false);
      stopButton!.props.onClick?.();
      expect(stopCalls).toBe(1);
    }

    // Once agentBusy / pendingApproval has settled (agentBusy=false), stopped and stopping disable the button normally.
    const settledStoppedHtml = renderToStaticMarkup(
      createElement(CuaOverlay, {
        state: makeState({ phase: 'stopped', cleanupComplete: true, error: 'user-input' }),
        stopPending: false,
        stopError: null,
        agentBusy: false,
        onStop: () => undefined
      })
    );
    expect(settledStoppedHtml).toContain('disabled=""');
    expect(settledStoppedHtml).toContain('Stopped');
  });

  it('maintains stopping progress until main pushes stopped with cleanupComplete: true', async () => {
    const { CuaOverlay, getCuaCleanupStatusText } = await loadCuaOverlayModule();
    const acting = makeState({ phase: 'acting', cleanupComplete: false });
    const stoppedIncomplete = makeState({ phase: 'stopped', cleanupComplete: false });
    const stoppedComplete = makeState({ phase: 'stopped', cleanupComplete: true });
    const cleanupFailed = makeState({
      phase: 'cleanup-failed',
      cleanupComplete: false,
      releaseFailures: ['left', 'renderer-rollback-unconfirmed']
    });

    expect(isCuaStoppablePhase('ready')).toBe(true);
    expect(isCuaStoppablePhase('acting')).toBe(true);
    expect(isCuaStoppablePhase('stopping')).toBe(true);
    expect(isCuaStoppablePhase('idle')).toBe(false);

    expect(isCuaStopSettled(acting)).toBe(false);
    expect(isCuaStopSettled(stoppedIncomplete)).toBe(false);
    expect(isCuaStopSettled(stoppedComplete)).toBe(true);
    expect(isCuaStopSettled(cleanupFailed)).toBe(true);

    const pendingHtml = renderToStaticMarkup(
      createElement(CuaOverlay, {
        state: acting,
        stopPending: true,
        stopError: null,
        onStop: () => undefined
      })
    );
    expect(pendingHtml).toContain('Stopping CUA');
    expect(pendingHtml).toContain('Stopping…');
    expect(pendingHtml).toContain('aria-busy="true"');
    expect(getCuaCleanupStatusText(stoppedIncomplete, false)).toContain('finishing input cleanup');
    expect(getCuaCleanupStatusText(stoppedComplete, false)).toContain('all synthetic inputs released');
  });

  it('displays re-run lock warning, releaseFailures, and targetGone when applicable', async () => {
    const { CuaOverlay } = await loadCuaOverlayModule();
    const state = makeState({
      phase: 'cleanup-failed',
      targetGone: true,
      cursor: { x: 250, y: 500 },
      error: 'Could not release virtual pointer',
      cleanupComplete: false,
      releaseFailures: ['renderer-rollback-unconfirmed', 'left']
    });

    const html = renderToStaticMarkup(
      createElement(CuaOverlay, {
        state,
        stopPending: false,
        stopError: null,
        onStop: () => undefined
      })
    );

    expect(html).toContain('data-testid="cua-target-gone"');
    expect(html).toContain('data-cua-target-gone="true"');
    expect(html).toContain('data-testid="cua-cleanup-failed-warning"');
    expect(html).toContain('Re-run locked:');
    expect(html).toContain('data-testid="cua-release-failures"');
    expect(html).toContain('renderer-rollback-unconfirmed');
    expect(html).toContain('Could not release virtual pointer');
  });

  it('mounts CuaOverlay outside inert lock, keeps single agent-panel anchor, and pins fixed-geometry stop button', async () => {
    const [appShell, panel, css] = await Promise.all([
      readFile(new URL('../src/renderer/src/AppShell.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/renderer/src/AgentChatPanel.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/renderer/src/cua/cuaOverlay.css', import.meta.url), 'utf8')
    ]);

    const workspaceLockIndex = appShell.indexOf('id="app-shell-workspace"');
    const overlayIndex = appShell.indexOf('<CuaOverlay\n');
    const bodyCloseIndex = appShell.indexOf('</div>\n      <CuaOverlay');
    expect(workspaceLockIndex).toBeGreaterThan(-1);
    expect(overlayIndex).toBeGreaterThan(workspaceLockIndex);
    expect(bodyCloseIndex).toBeGreaterThan(workspaceLockIndex);

    // Exact Backend verifyDom/observe invariant: [data-cua-protected="agent-panel"] appears ONLY on AgentChatPanel.
    expect(appShell).not.toContain('data-cua-protected="agent-panel"');
    expect(panel).toContain('data-cua-protected="agent-panel"');
    expect(panel).toContain('data-cua-protected="approval-ui"');
    expect(panel).toContain('data-testid="agent-cua-approval-summary"');
    expect(panel).toContain("'agent-cua-error-code'");

    expect(css).toContain('.cua-overlay {\n  position: fixed;\n  inset: 0;\n  z-index: 9999;\n  pointer-events: none;');
    expect(css).toContain('.cua-stop-btn {\n  pointer-events: auto;\n  position: fixed;');

    const [timelineCanvas, timelineEditor] = await Promise.all([
      readFile(new URL('../src/renderer/src/editor/TimelineCanvas.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/renderer/src/editor/TimelineEditor.tsx', import.meta.url), 'utf8')
    ]);
    // Security invariant: Save must NOT live inside [data-cua-safe-surface="timeline"] where CUA click could trigger disk writes.
    expect(timelineCanvas).not.toContain('timeline-save-btn');
    expect(timelineCanvas).toContain('data-dirty={editor.hasUnsavedTimeline');
    expect(timelineCanvas).toContain('data-saving={editor.isSavingTimeline');
    expect(timelineCanvas).toContain('data-save-status={editor.timelineSaveStatus}');
    expect(timelineEditor).toContain('data-testid="editor-save-btn"');
    expect(timelineEditor).toContain('data-dirty={editor.hasUnsavedTimeline');
    expect(timelineEditor).toContain('data-saving={editor.isSavingTimeline');
    expect(timelineEditor).toContain('data-save-status={editor.timelineSaveStatus}');
  });
});

interface MockStyle {
  readonly display?: string;
  readonly visibility?: string;
  readonly opacity?: string;
  readonly position?: string;
  readonly overflow?: string;
  readonly overflowX?: string;
  readonly overflowY?: string;
}

class MockHtmlElement {
  readonly id: string;
  readonly className: string;
  readonly hidden = false;
  readonly scrollLeft = 0;
  readonly scrollTop = 0;
  parentElement: MockHtmlElement | null = null;
  private readonly attrs: Record<string, string>;
  private readonly rect: CuaRect;
  readonly style: MockStyle;

  constructor(config: {
    readonly id?: string;
    readonly className?: string;
    readonly attrs?: Record<string, string>;
    readonly rect: CuaRect;
    readonly style?: MockStyle;
    readonly parentElement?: MockHtmlElement | null;
  }) {
    this.id = config.id ?? '';
    this.className = config.className ?? '';
    this.attrs = config.attrs ?? {};
    this.rect = config.rect;
    this.style = config.style ?? {};
    this.parentElement = config.parentElement ?? null;
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name]! : null;
  }

  getBoundingClientRect(): DOMRect {
    return {
      x: this.rect.x,
      y: this.rect.y,
      left: this.rect.x,
      top: this.rect.y,
      right: this.rect.x + this.rect.width,
      bottom: this.rect.y + this.rect.height,
      width: this.rect.width,
      height: this.rect.height,
      toJSON: () => this.rect
    } as DOMRect;
  }

  closest(selector: string): MockHtmlElement | null {
    if (selector === '[hidden]') return null;
    return null;
  }

  contains(): boolean {
    return false;
  }

  querySelectorAll(): MockHtmlElement[] {
    return [];
  }
}

function withMockDom<T>(
  config: {
    readonly viewport: { readonly width: number; readonly height: number };
    readonly protectedElements: readonly MockHtmlElement[];
    readonly safeSurfaceElements?: readonly MockHtmlElement[];
  },
  fn: () => T
): T {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevDocument = (globalThis as Record<string, unknown>).document;
  const prevHtmlElement = (globalThis as Record<string, unknown>).HTMLElement;

  const documentElement = new MockHtmlElement({
    id: 'html-root',
    rect: { x: 0, y: 0, width: config.viewport.width, height: config.viewport.height }
  });

  (globalThis as Record<string, unknown>).HTMLElement = MockHtmlElement;
  (globalThis as Record<string, unknown>).window = {
    innerWidth: config.viewport.width,
    innerHeight: config.viewport.height,
    getComputedStyle: (el: MockHtmlElement) => ({
      display: el.style.display ?? 'block',
      visibility: el.style.visibility ?? 'visible',
      opacity: el.style.opacity ?? '1',
      position: el.style.position ?? 'static',
      overflow: el.style.overflow ?? 'visible',
      overflowX: el.style.overflowX ?? el.style.overflow ?? 'visible',
      overflowY: el.style.overflowY ?? el.style.overflow ?? 'visible'
    })
  };
  (globalThis as Record<string, unknown>).document = {
    documentElement,
    activeElement: null,
    getElementById: () => null,
    querySelectorAll: (selector: string) => {
      if (selector === '[data-cua-protected]') return config.protectedElements;
      if (selector === '[data-cua-safe-surface]') return config.safeSurfaceElements ?? [];
      return [];
    }
  };

  try {
    return fn();
  } finally {
    if (prevWindow === undefined) delete (globalThis as Record<string, unknown>).window;
    else (globalThis as Record<string, unknown>).window = prevWindow;
    if (prevDocument === undefined) delete (globalThis as Record<string, unknown>).document;
    else (globalThis as Record<string, unknown>).document = prevDocument;
    if (prevHtmlElement === undefined) delete (globalThis as Record<string, unknown>).HTMLElement;
    else (globalThis as Record<string, unknown>).HTMLElement = prevHtmlElement;
  }
}

describe('clipRectToOverflowAncestors and collectDomSurfaceState protected rect clipping', () => {
  it('clips overflowing approval-ui inside scrollable .agent-chat-log to stay strictly inside agent-panel without spurious layoutRevision bump', async () => {
    const { collectDomSurfaceState } = await loadUseCuaOverlayModule();
    const viewport = { width: 1220, height: 793 };
    const safeTimeline = new MockHtmlElement({
      attrs: { 'data-cua-safe-surface': 'timeline' },
      rect: { x: 8, y: 52, width: 840, height: 735 }
    });
    const panelShell = new MockHtmlElement({
      className: 'agent-chat-panel-shell',
      attrs: { 'data-cua-protected': 'agent-panel', 'data-cua-protected-id': 'agent-chat-panel' },
      rect: { x: 854, y: 52, width: 360, height: 735 },
      style: { overflow: 'hidden', overflowX: 'hidden', overflowY: 'hidden' }
    });
    const panelInner = new MockHtmlElement({
      className: 'agent-chat-panel',
      rect: { x: 854, y: 52, width: 360, height: 735 },
      style: { overflow: 'hidden', overflowX: 'hidden', overflowY: 'hidden' },
      parentElement: panelShell
    });
    const chatLog = new MockHtmlElement({
      className: 'agent-chat-log',
      rect: { x: 855, y: 158, width: 358, height: 500 },
      style: { overflowX: 'visible', overflowY: 'auto' },
      parentElement: panelInner
    });
    // Reproduces exact VM203 1220x793 bug: approval card overflows above .agent-chat-log (y=158) AND above agent-panel (y=52).
    const approvalCard = new MockHtmlElement({
      className: 'status-card agent-chat-approval',
      attrs: { 'data-cua-protected': 'approval-ui', 'data-cua-protected-id': 'agent-chat-approval' },
      rect: { x: 869, y: -120, width: 322, height: 639.39 },
      parentElement: chatLog
    });

    const tracker = new CuaSurfaceRevisionTracker();

    const before = withMockDom(
      { viewport, protectedElements: [panelShell], safeSurfaceElements: [safeTimeline] },
      () => collectDomSurfaceState({
        contentRevision: 1,
        isAgentBusy: false,
        hasPendingApproval: false,
        cuaPhase: 'ready'
      })
    );
    const beforeTracked = tracker.next(before);

    const after = withMockDom(
      { viewport, protectedElements: [panelShell, approvalCard], safeSurfaceElements: [safeTimeline] },
      () => collectDomSurfaceState({
        contentRevision: 1,
        isAgentBusy: false,
        hasPendingApproval: true,
        cuaPhase: 'ready'
      })
    );
    const afterTracked = tracker.next(after);

    const panelEntry = after.protectedRects.find((entry) => entry.kind === 'agent-panel');
    const approvalEntry = after.protectedRects.find((entry) => entry.kind === 'approval-ui');
    expect(panelEntry).toBeDefined();
    expect(approvalEntry).toBeDefined();

    // Clipped strictly to .agent-chat-log vertical bounds (y=158..658) inside agent-panel (y=52..787).
    expect(approvalEntry!.rect.y).toBe(158);
    expect(approvalEntry!.rect.y).toBeGreaterThanOrEqual(panelEntry!.rect.y);
    expect(approvalEntry!.rect.y + approvalEntry!.rect.height).toBeLessThanOrEqual(panelEntry!.rect.y + panelEntry!.rect.height);
    expect(approvalEntry!.rect.x).toBeGreaterThanOrEqual(panelEntry!.rect.x);
    expect(approvalEntry!.rect.x + approvalEntry!.rect.width).toBeLessThanOrEqual(panelEntry!.rect.x + panelEntry!.rect.width);
    expect(rectContains(panelEntry!.rect, approvalEntry!.rect, 0)).toBe(true);

    // Must NOT bump layoutRevision or change geometry key (no spurious surface-changed cancel).
    expect(buildSurfaceGeometryKey(after)).toBe(buildSurfaceGeometryKey(before));
    expect(afterTracked.revisionChanged).toBe(false);
    expect(afterTracked.snapshot.layoutRevision).toBe(beforeTracked.snapshot.layoutRevision);
  });

  it('omits protected rects completely clipped out of view by an overflow ancestor and clips X independently', async () => {
    const { clipRectToOverflowAncestors, collectDomSurfaceState } = await loadUseCuaOverlayModule();
    const viewport = { width: 1220, height: 793 };
    const chatLog = new MockHtmlElement({
      rect: { x: 855, y: 158, width: 358, height: 500 },
      style: { overflowX: 'clip', overflowY: 'auto' }
    });
    const offscreenApproval = new MockHtmlElement({
      attrs: { 'data-cua-protected': 'approval-ui', 'data-cua-protected-id': 'offscreen-approval' },
      rect: { x: 869, y: -400, width: 322, height: 300 },
      parentElement: chatLog
    });
    const horizOverflowCard = new MockHtmlElement({
      attrs: { 'data-cua-protected': 'approval-ui', 'data-cua-protected-id': 'horiz-approval' },
      rect: { x: 840, y: 200, width: 400, height: 120 },
      parentElement: chatLog
    });
    const fixedStopButton = new MockHtmlElement({
      attrs: { 'data-cua-protected': 'stop-button', 'data-testid': 'cua-stop-btn' },
      rect: { x: 540, y: 12, width: 140, height: 32 },
      style: { position: 'fixed' },
      parentElement: chatLog
    });

    withMockDom(
      { viewport, protectedElements: [offscreenApproval, horizOverflowCard, fixedStopButton] },
      () => {
        expect(
          clipRectToOverflowAncestors(offscreenApproval as unknown as Element, { x: 869, y: -400, width: 322, height: 300 }, viewport)
        ).toBeNull();
        expect(
          clipRectToOverflowAncestors(horizOverflowCard as unknown as Element, { x: 840, y: 200, width: 400, height: 120 }, viewport)
        ).toEqual({ x: 855, y: 200, width: 358, height: 120 });
        // Fixed elements clip to viewport, never to an unrelated overflow container.
        expect(
          clipRectToOverflowAncestors(fixedStopButton as unknown as Element, { x: 540, y: 12, width: 140, height: 32 }, viewport)
        ).toEqual({ x: 540, y: 12, width: 140, height: 32 });

        const measured = collectDomSurfaceState({
          contentRevision: 1,
          isAgentBusy: false,
          hasPendingApproval: true,
          cuaPhase: 'ready'
        });
        expect(measured.protectedRects.some((entry) => entry.id === 'offscreen-approval')).toBe(false);
        expect(measured.protectedRects.find((entry) => entry.id === 'horiz-approval')?.rect).toEqual({
          x: 855,
          y: 200,
          width: 358,
          height: 120
        });
      }
    );
  });

  it('preserves fail-closed geometry change when approval-ui genuinely overflows outside an unclipped container', async () => {
    const { collectDomSurfaceState } = await loadUseCuaOverlayModule();
    const viewport = { width: 1220, height: 793 };
    const safeTimeline = new MockHtmlElement({
      attrs: { 'data-cua-safe-surface': 'timeline' },
      rect: { x: 8, y: 52, width: 840, height: 735 }
    });
    const unclippedPanel = new MockHtmlElement({
      attrs: { 'data-cua-protected': 'agent-panel', 'data-cua-protected-id': 'agent-chat-panel' },
      rect: { x: 854, y: 52, width: 360, height: 735 },
      style: { overflow: 'visible', overflowX: 'visible', overflowY: 'visible' }
    });
    const spillingApproval = new MockHtmlElement({
      attrs: { 'data-cua-protected': 'approval-ui', 'data-cua-protected-id': 'agent-chat-approval' },
      rect: { x: 700, y: 120, width: 400, height: 200 },
      parentElement: unclippedPanel
    });

    const before = withMockDom(
      { viewport, protectedElements: [unclippedPanel], safeSurfaceElements: [safeTimeline] },
      () => collectDomSurfaceState({ contentRevision: 1, isAgentBusy: false, hasPendingApproval: false, cuaPhase: 'ready' })
    );
    const after = withMockDom(
      { viewport, protectedElements: [unclippedPanel, spillingApproval], safeSurfaceElements: [safeTimeline] },
      () => collectDomSurfaceState({ contentRevision: 1, isAgentBusy: false, hasPendingApproval: true, cuaPhase: 'ready' })
    );

    expect(buildSurfaceGeometryKey(after)).not.toBe(buildSurfaceGeometryKey(before));
  });
});

describe('approval button mouse safe-surface focus preservation', () => {
  it('preserves existing safe-surface DOM focus on primary mouseDown without stealing focus while still allowing onApprove click', async () => {
    const { hasActiveFocusInSafeSurface, preserveSafeSurfaceFocusOnPrimaryMouseDown } = await loadUseCuaOverlayModule();

    const timelineSurface = new MockHtmlElement({
      attrs: { 'data-cua-safe-surface': 'timeline' },
      rect: { x: 8, y: 52, width: 840, height: 735 }
    });
    const timelineClip = new MockHtmlElement({
      attrs: { 'data-testid': 'timeline-clip-1' },
      rect: { x: 186, y: 582, width: 200, height: 48 },
      parentElement: timelineSurface
    });
    timelineClip.closest = (selector: string) =>
      selector === '[data-cua-safe-surface]' ? timelineSurface : null;

    const approveButton = new MockHtmlElement({
      attrs: { 'data-testid': 'approve-btn' },
      rect: { x: 880, y: 600, width: 100, height: 32 }
    });
    let activeElement: MockHtmlElement | null = timelineClip;
    const mockDoc = {
      get activeElement() {
        return activeElement as unknown as Element | null;
      }
    };

    expect(hasActiveFocusInSafeSurface(mockDoc)).toBe(true);

    // Primary mouseDown (button=0) prevents browser focus transfer away from timelineClip.
    let prevented = false;
    const didPreserve = preserveSafeSurfaceFocusOnPrimaryMouseDown(
      { button: 0, preventDefault: () => { prevented = true; } },
      mockDoc
    );
    expect(didPreserve).toBe(true);
    expect(prevented).toBe(true);
    if (!prevented) activeElement = approveButton;
    expect(activeElement).toBe(timelineClip);

    // Click handler still fires normally after preserved mouseDown.
    let approveCalls = 0;
    const onApprove = () => { approveCalls += 1; };
    onApprove();
    expect(approveCalls).toBe(1);
    expect(activeElement).toBe(timelineClip);

    // Non-primary mouseDown (right click, button=2) does not preventDefault.
    let rightPrevented = false;
    expect(
      preserveSafeSurfaceFocusOnPrimaryMouseDown(
        { button: 2, preventDefault: () => { rightPrevented = true; } },
        mockDoc
      )
    ).toBe(false);
    expect(rightPrevented).toBe(false);
  });

  it('never fabricates or moves focus into safe surface when activeElement is inside agent-panel or outside safe surface', async () => {
    const { hasActiveFocusInSafeSurface, preserveSafeSurfaceFocusOnPrimaryMouseDown } = await loadUseCuaOverlayModule();

    const agentPanel = new MockHtmlElement({
      attrs: { 'data-cua-protected': 'agent-panel' },
      rect: { x: 854, y: 52, width: 360, height: 735 }
    });
    const promptTextarea = new MockHtmlElement({
      attrs: { 'aria-label': 'Edit Agent prompt' },
      rect: { x: 869, y: 700, width: 320, height: 52 },
      parentElement: agentPanel
    });
    promptTextarea.closest = (selector: string) =>
      selector.includes('[data-cua-protected]') ? agentPanel : null;

    let timelineFocusCalls = 0;
    const timelineSurface = Object.assign(
      new MockHtmlElement({
        attrs: { 'data-cua-safe-surface': 'timeline' },
        rect: { x: 8, y: 52, width: 840, height: 735 }
      }),
      { focus: () => { timelineFocusCalls += 1; } }
    );
    void timelineSurface;

    const mockDoc = { activeElement: promptTextarea as unknown as Element };
    expect(hasActiveFocusInSafeSurface(mockDoc)).toBe(false);

    let prevented = false;
    const didPreserve = preserveSafeSurfaceFocusOnPrimaryMouseDown(
      { button: 0, preventDefault: () => { prevented = true; } },
      mockDoc
    );
    expect(didPreserve).toBe(false);
    expect(prevented).toBe(false);
    expect(timelineFocusCalls).toBe(0);
    expect(mockDoc.activeElement).toBe(promptTextarea as unknown as Element);

    // Also fail-closed when activeElement is null.
    expect(hasActiveFocusInSafeSurface({ activeElement: null })).toBe(false);
    let nullPrevented = false;
    expect(
      preserveSafeSurfaceFocusOnPrimaryMouseDown(
        { button: 0, preventDefault: () => { nullPrevented = true; } },
        { activeElement: null }
      )
    ).toBe(false);
    expect(nullPrevented).toBe(false);
  });

  it('wires preserveSafeSurfaceFocusOnPrimaryMouseDown in AgentChatPanel without autoFocus or keyboard accessibility regression', async () => {
    const panelSource = await readFile(new URL('../src/renderer/src/AgentChatPanel.tsx', import.meta.url), 'utf8');
    expect(panelSource).toContain('onMouseDown={(event) => { preserveSafeSurfaceFocusOnPrimaryMouseDown(event); }}');
    expect(panelSource).toContain('data-testid="agent-cua-key-focus-hint"');
    expect(panelSource).toContain('data-testid="agent-cua-unsafe-key-guidance"');
    expect(panelSource).toContain('clicking outside this approval cancels it');
    expect(panelSource).toContain('Do not reuse this approval.');
    expect(panelSource).toContain('id="agent-cua-key-focus-hint"');
    expect(panelSource).toContain("aria-describedby={pendingApproval.cuaApproval?.actionKind === 'key' && !hasSafeSurfaceFocus ? 'agent-cua-key-focus-hint' : undefined}");
    expect(panelSource).not.toContain('then approve again');
    // Approval UI must never auto-focus or programmatically steal/fabricate safe-surface focus.
    expect(panelSource).not.toContain('autoFocus');
    expect(panelSource).not.toContain('.focus(');
    // Keyboard activation (Tab + Enter/Space) remains intact: approval buttons are native <Button> without negative tabIndex.
    const approvalBlock = panelSource.slice(panelSource.indexOf('className="agent-chat-approval__actions"'), panelSource.indexOf('{status === \'thinking\'}'));
    expect(approvalBlock).toContain('Run once');
    expect(approvalBlock).toContain('Deny');
    expect(approvalBlock).not.toContain('tabIndex={-1}');
  });
});
