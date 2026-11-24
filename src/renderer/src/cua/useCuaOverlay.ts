import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import type { CuaPhase, CuaState, CuaSurfaceSnapshot } from '../../../shared/cua';
import {
  abortActiveTimelineDragSync,
  handleCuaStateRollbackAndAckSync
} from './cuaDragGuard';
import {
  CUA_VALID_PROTECTED_KINDS,
  CUA_VALID_SAFE_KINDS,
  CuaSurfaceRevisionTracker,
  INITIAL_CUA_STATE,
  clipRectToViewport,
  computeExecutionBlockState,
  computeWorkspaceInert,
  createFailClosedSnapshot,
  excludeProtectedFromSafeSurface,
  isCuaStopSettled,
  isCuaStoppablePhase,
  roundRect,
  type CuaProtectedKind,
  type CuaProtectedRectEntry,
  type CuaSafeSurfaceKind,
  type MeasuredSurfaceState,
  type SurfaceScrollState
} from './cuaSurfaceSnapshot';

export {
  INITIAL_CUA_STATE,
  computeExecutionBlockState,
  computeWorkspaceInert,
  isCuaStopSettled,
  isCuaStoppablePhase
} from './cuaSurfaceSnapshot';

function isElementVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.hidden || element.closest('[hidden]') !== null) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getElementProtectedId(element: HTMLElement, kind: CuaProtectedKind, kindIndex: number, fallbackId?: string): string {
  return (
    element.getAttribute('data-cua-protected-id') ??
    element.getAttribute('data-testid') ??
    (element.id.length > 0 ? element.id : fallbackId !== undefined ? (kindIndex === 0 ? fallbackId : `${fallbackId}-${kindIndex}`) : `${kind}-${kindIndex}`)
  );
}

export interface CollectDomSurfaceOptions {
  readonly isAgentBusy: boolean;
  readonly hasPendingApproval: boolean;
  readonly approvalInFlight: boolean;
  readonly cuaPhase: CuaPhase;
  readonly isUpdating?: boolean;
}

export function collectDomSurfaceState(options: CollectDomSurfaceOptions): MeasuredSurfaceState {
  const viewport = {
    width: Math.max(0, Math.round(window.innerWidth)),
    height: Math.max(0, Math.round(window.innerHeight))
  };

  if (options.isUpdating === true || viewport.width <= 0 || viewport.height <= 0) {
    return {
      executionBlocked: true,
      blockReason: 'updating',
      viewport,
      safeSurface: null,
      protectedRects: [],
      focusedInSafeSurface: false,
      focusedTestId: null,
      scrollStates: [],
      hasBlockingOverlay: true
    };
  }

  const protectedRects: CuaProtectedRectEntry[] = [];
  const seenElements = new Set<Element>();
  const countByPrefix = new Map<string, number>();

  const addProtected = (element: Element, kind: CuaProtectedKind, fallbackId?: string): void => {
    if (seenElements.has(element) || !isElementVisible(element)) return;
    const clipped = clipRectToViewport(roundRect(element.getBoundingClientRect()), viewport);
    if (clipped === null) return;
    seenElements.add(element);
    const prefix = fallbackId ?? kind;
    const kindIndex = countByPrefix.get(prefix) ?? 0;
    countByPrefix.set(prefix, kindIndex + 1);
    protectedRects.push({
      id: getElementProtectedId(element as HTMLElement, kind, kindIndex, fallbackId),
      kind,
      rect: clipped
    });
  };

  // 1. Explicit data-cua-protected anchors.
  document.querySelectorAll('[data-cua-protected]').forEach((element) => {
    const rawKind = element.getAttribute('data-cua-protected') as CuaProtectedKind | null;
    if (rawKind !== null && CUA_VALID_PROTECTED_KINDS.has(rawKind)) {
      addProtected(element, rawKind);
    }
  });

  // 2. Defense-in-depth: detect modals, settings, top editor header, and open popups even without explicit anchors.
  document.querySelectorAll('[role="dialog"][aria-modal="true"], dialog[open]').forEach((element) => {
    addProtected(element, 'modal', 'modal-dialog');
  });
  document.querySelectorAll('[role="menu"], details.workbench-menu[open] .workbench-menu__popover').forEach((element) => {
    addProtected(element, 'chrome-menu', 'menu-popup');
  });
  document.querySelectorAll('.oc-editor-host__header').forEach((element) => {
    addProtected(element, 'chrome-menu', 'editor-workbench-header');
  });

  const hasOpenMenuPopup = Array.from(
    document.querySelectorAll('[role="menu"], details.workbench-menu[open] .workbench-menu__popover')
  ).some((element) => isElementVisible(element));
  const hasModal = protectedRects.some((entry) => entry.kind === 'modal');
  const hasSettings = protectedRects.some((entry) => entry.kind === 'settings');
  const projectsPage = document.getElementById('app-page-panel-projects');
  const projectsVisible = projectsPage !== null && isElementVisible(projectsPage);
  const hasBlockingOverlay = hasModal || hasSettings || projectsVisible || hasOpenMenuPopup;

  // 3. Locate active safe surface candidate (fail-closed if blocking overlay or non-editor view).
  let safeSurfaceElement: HTMLElement | null = null;
  let safeSurface: CuaSurfaceSnapshot['safeSurface'] = null;

  if (!hasBlockingOverlay) {
    const candidates = Array.from(document.querySelectorAll('[data-cua-safe-surface]'));
    for (const candidate of candidates) {
      const kind = candidate.getAttribute('data-cua-safe-surface') as CuaSafeSurfaceKind | null;
      if (kind === null || !CUA_VALID_SAFE_KINDS.has(kind)) continue;
      if (!isElementVisible(candidate)) continue;
      const clipped = clipRectToViewport(roundRect(candidate.getBoundingClientRect()), viewport);
      if (clipped === null) continue;
      const safeRect = excludeProtectedFromSafeSurface(clipped, protectedRects);
      if (safeRect === null) continue;
      safeSurfaceElement = candidate as HTMLElement;
      // safeSurface.interactive stays true while the editor surface is valid so
      // toggling executionBlocked/workspaceInert during approval does not alter
      // JSON.stringify(safeSurface) and invalidate the bound CuaFrame.
      safeSurface = {
        kind,
        rect: safeRect,
        interactive: true
      };
      break;
    }
  }

  // 4. Scroll state strictly inside the safe surface (never inside AgentChatPanel).
  const scrollStates: SurfaceScrollState[] = [];
  if (safeSurfaceElement !== null) {
    scrollStates.push({
      id: safeSurfaceElement.id || safeSurface?.kind || 'safe-surface',
      scrollLeft: safeSurfaceElement.scrollLeft,
      scrollTop: safeSurfaceElement.scrollTop
    });
    const scrollSelectors = '.timeline-stack, .video-canvas__scroll, .shorts-workspace';
    safeSurfaceElement.querySelectorAll(scrollSelectors).forEach((el, idx) => {
      if (el instanceof HTMLElement) {
        scrollStates.push({
          id: el.getAttribute('data-testid') ?? el.className.split(' ')[0] ?? `scroll-${idx}`,
          scrollLeft: el.scrollLeft,
          scrollTop: el.scrollTop
        });
      }
    });
  }

  // 5. Focus tracking strictly within the safe surface (so clicking inside AgentChatPanel never bumps revision).
  const activeElement = document.activeElement;
  const focusedInSafeSurface =
    safeSurfaceElement !== null &&
    activeElement instanceof HTMLElement &&
    safeSurfaceElement.contains(activeElement) &&
    activeElement.closest('[data-cua-protected],[role="dialog"],[role="menu"],.oc-editor-host__header') === null;
  const focusedTestId = focusedInSafeSurface
    ? (activeElement.getAttribute('data-testid') ?? activeElement.closest('[data-testid]')?.getAttribute('data-testid') ?? null)
    : null;

  const { executionBlocked, blockReason } = computeExecutionBlockState({
    isAgentBusy: options.isAgentBusy,
    hasPendingApproval: options.hasPendingApproval,
    approvalInFlight: options.approvalInFlight,
    hasBlockingOverlay,
    hasSafeSurface: safeSurface !== null,
    cuaPhase: options.cuaPhase
  });

  return {
    executionBlocked,
    blockReason,
    viewport,
    safeSurface,
    protectedRects,
    focusedInSafeSurface,
    focusedTestId,
    scrollStates,
    hasBlockingOverlay,
    cuaActing: options.cuaPhase === 'acting'
  };
}

export interface CuaOverlayController {
  readonly state: CuaState;
  readonly stopPending: boolean;
  readonly stopError: string | null;
  readonly snapshot: CuaSurfaceSnapshot;
  readonly isActing: boolean;
  readonly isWorkspaceInert: boolean;
  readonly requestStop: () => Promise<void>;
  readonly refreshSnapshot: () => void;
}

const CuaOverlayContext = createContext<CuaOverlayController | null>(null);

export function useCuaOverlayState(options: {
  readonly isAgentBusy: boolean;
  readonly hasPendingApproval: boolean;
  readonly approvalInFlight: boolean;
  readonly activePageId: string;
}): CuaOverlayController {
  const [state, setState] = useState<CuaState>(INITIAL_CUA_STATE);
  const [stopPending, setStopPending] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const trackerRef = useRef<CuaSurfaceRevisionTracker>(new CuaSurfaceRevisionTracker());
  const [snapshot, setSnapshot] = useState<CuaSurfaceSnapshot>(() => createFailClosedSnapshot(0));
  const isWorkspaceInert = computeWorkspaceInert({
    isAgentBusy: options.isAgentBusy,
    hasPendingApproval: options.hasPendingApproval,
    approvalInFlight: options.approvalInFlight,
    cuaPhase: state.phase
  });
  const stateRef = useRef<CuaState>(state);
  const stopPendingRef = useRef<boolean>(stopPending);
  const optionsRef = useRef(options);
  const rafIdRef = useRef<number | null>(null);

  stateRef.current = state;
  stopPendingRef.current = stopPending;
  optionsRef.current = options;

  const reportSnapshot = useCallback((nextSnapshot: CuaSurfaceSnapshot): void => {
    setSnapshot(nextSnapshot);
    const api = typeof window === 'undefined' ? undefined : window.videoTool;
    if (typeof api?.cuaReportSurfaceSnapshot !== 'function') return;
    if (nextSnapshot.viewport.width <= 0 || nextSnapshot.viewport.height <= 0) return;
    void api.cuaReportSurfaceSnapshot(nextSnapshot).catch(() => {
      // Main-process CUA runtime may not be registered yet in contract-only builds.
    });
  }, []);

  const flushSnapshot = useCallback((): void => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const currentOpts = optionsRef.current;
    const measured = collectDomSurfaceState({
      isAgentBusy: currentOpts.isAgentBusy,
      hasPendingApproval: currentOpts.hasPendingApproval,
      approvalInFlight: currentOpts.approvalInFlight,
      cuaPhase: stateRef.current.phase
    });
    const { snapshot: nextSnapshot, changed } = trackerRef.current.next(measured);
    if (changed) {
      reportSnapshot(nextSnapshot);
    }
  }, [reportSnapshot]);

  const scheduleSnapshot = useCallback((): void => {
    if (typeof window === 'undefined') return;
    if (rafIdRef.current !== null) return;
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      flushSnapshot();
    });
  }, [flushSnapshot]);

  const applyCuaState = useCallback((nextState: CuaState): void => {
    stateRef.current = nextState;
    setState(nextState);
    if (isCuaStopSettled(nextState)) {
      setStopPending(false);
    }
    if (nextState.phase === 'idle' || nextState.phase === 'ready' || nextState.phase === 'acting') {
      setStopError(null);
    }
  }, []);

  const requestStop = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (!isCuaStoppablePhase(current.phase) && !stopPendingRef.current) return;
    if (stopPendingRef.current) return;

    // Synchronously roll back any active timeline drag BEFORE calling cuaStop()
    // so the driver's synthetic mouseUp release cannot commit a partial drag.
    abortActiveTimelineDragSync();

    // Immediately show stop-in-progress; never declare stopped until main pushes
    // phase === 'stopped' && cleanupComplete === true.
    setStopPending(true);
    setStopError(null);

    const api = typeof window === 'undefined' ? undefined : window.videoTool;
    if (typeof api?.cuaStop !== 'function') {
      setStopPending(false);
      setStopError('CUA stop control is unavailable.');
      return;
    }

    try {
      const response = await api.cuaStop();
      if (!response.ok) {
        setStopPending(false);
        setStopError(response.error.message);
        return;
      }
      if (!response.value.accepted) {
        if (isCuaStopSettled(stateRef.current)) {
          setStopPending(false);
        } else {
          setStopPending(false);
          setStopError('Stop request was not accepted by the CUA driver.');
        }
      }
      // If accepted === true, keep stopPending === true until main pushes stopped + cleanupComplete!
    } catch (cause) {
      setStopPending(false);
      setStopError(cause instanceof Error ? cause.message : 'Failed to request CUA stop.');
    }
  }, []);

  // Subscribe to main-process CUA state and load initial state.
  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.videoTool;
    let active = true;

    const unsubscribe = typeof api?.onCuaStateChanged === 'function'
      ? api.onCuaStateChanged((nextState) => {
          // MUST run synchronously BEFORE React setState: abort any held drag
          // and immediately acknowledge cancelToken via cuaAckCancel.
          handleCuaStateRollbackAndAckSync(nextState, api.cuaAckCancel);
          if (active) applyCuaState(nextState);
        })
      : undefined;

    if (typeof api?.cuaGetState === 'function') {
      void api.cuaGetState()
        .then((response) => {
          if (active && response.ok) {
            handleCuaStateRollbackAndAckSync(response.value, api.cuaAckCancel);
            applyCuaState(response.value);
          }
        })
        .catch(() => {
          // Ignore if main-process CUA runtime is not registered yet.
        });
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [applyCuaState]);

  // Global capture-phase Escape shortcut for immediate user stop.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (!isCuaStoppablePhase(stateRef.current.phase)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void requestStop();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [requestStop]);

  // Report fail-closed immediately on mount, then observe layout, scroll, DOM, and focus changes.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const initialFailClosed = trackerRef.current.failClosed(
      { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) },
      'initializing'
    );
    reportSnapshot(initialFailClosed);
    flushSnapshot();

    const onScroll = (event: Event): void => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-cua-protected="agent-panel"]') !== null) {
        return;
      }
      flushSnapshot();
    };

    const onResize = (): void => flushSnapshot();
    const onFocusChange = (): void => scheduleSnapshot();

    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('focusin', onFocusChange, true);
    document.addEventListener('focusout', onFocusChange, true);

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => scheduleSnapshot())
      : null;

    if (resizeObserver !== null) {
      resizeObserver.observe(document.documentElement);
      const workspace = document.getElementById('app-shell-workspace');
      const chatPanel = document.getElementById('app-shell-agent-chat');
      if (workspace !== null) resizeObserver.observe(workspace);
      if (chatPanel !== null) resizeObserver.observe(chatPanel);
    }

    const mutationObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          if (resizeObserver !== null) {
            const chatPanel = document.getElementById('app-shell-agent-chat');
            const safeSurface = document.querySelector('[data-cua-safe-surface]');
            if (chatPanel !== null) resizeObserver.observe(chatPanel);
            if (safeSurface !== null) resizeObserver.observe(safeSurface);
          }
          scheduleSnapshot();
        })
      : null;

    mutationObserver?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'open', 'inert', 'aria-modal', 'style', 'class', 'data-cua-safe-surface', 'data-cua-protected']
    });

    return () => {
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('focusin', onFocusChange, true);
      document.removeEventListener('focusout', onFocusChange, true);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();

      const unmountedSnapshot = trackerRef.current.failClosed(
        { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) },
        'unmounted'
      );
      reportSnapshot(unmountedSnapshot);
    };
  }, [flushSnapshot, reportSnapshot, scheduleSnapshot]);

  // Re-measure whenever page, busy/approval flags, or CUA phase changes.
  useEffect(() => {
    flushSnapshot();
  }, [flushSnapshot, options.activePageId, options.isAgentBusy, options.hasPendingApproval, options.approvalInFlight, state.phase]);

  return useMemo<CuaOverlayController>(
    () => ({
      state,
      stopPending,
      stopError,
      snapshot,
      isActing: state.phase === 'acting',
      isWorkspaceInert,
      requestStop,
      refreshSnapshot: flushSnapshot
    }),
    [flushSnapshot, isWorkspaceInert, requestStop, snapshot, state, stopError, stopPending]
  );
}

export function CuaOverlayProvider({
  controller,
  children
}: {
  readonly controller: CuaOverlayController;
  readonly children: ReactNode;
}): ReactElement {
  return createElement(CuaOverlayContext.Provider, { value: controller }, children);
}

export function useCuaOverlay(): CuaOverlayController | null {
  return useContext(CuaOverlayContext);
}

export function useCuaActing(): boolean {
  return useContext(CuaOverlayContext)?.isActing ?? false;
}
