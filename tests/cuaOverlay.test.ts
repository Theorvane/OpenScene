import { readFile } from 'node:fs/promises';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CuaState } from '../src/shared/cua';
import { INITIAL_CUA_STATE, isCuaStopSettled, isCuaStoppablePhase } from '../src/renderer/src/cua/cuaSurfaceSnapshot';

interface CuaOverlayModule {
  readonly CuaOverlay: ComponentType<{
    readonly state: CuaState;
    readonly stopPending: boolean;
    readonly stopError: string | null;
    readonly agentBusy?: boolean;
    readonly onStop: () => void;
  }>;
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
    expect(appShellSource).toContain('void cua.triggerStop();');
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
