import { createContext, createElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

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

function isElementVisible(element: Element, allowOpacityZero = false): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.hidden || element.closest('[hidden]') !== null) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (!allowOpacityZero && style.opacity === '0') return false;
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
  readonly contentRevision: number;
  readonly isAgentBusy: boolean;
  readonly hasPendingApproval: boolean;
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
      contentRevision: options.contentRevision,
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
    // Always keep the fixed-footprint stop-button in protectedRects even when
    // visually idle (opacity: 0) so idle -> ready -> acting never alters protectedRects.
    if (seenElements.has(element) || !isElementVisible(element, kind === 'stop-button')) return;
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
    hasBlockingOverlay,
    hasSafeSurface: safeSurface !== null,
    cuaPhase: options.cuaPhase
  });

  return {
    contentRevision: options.contentRevision,
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
  readonly isPreparing: boolean;
  readonly isWorkspaceInert: boolean;
  readonly requestStop: () => Promise<void>;
  readonly refreshSnapshot: () => void;
}

const CuaOverlayContext = createContext<CuaOverlayController | null>(null);

export function useCuaOverlayState(options: {
  readonly contentRevision: number;
  readonly isAgentBusy: boolean;
  readonly hasPendingApproval: boolean;
  readonly activePageId: string;
}): CuaOverlayController {
  const [state, setState] = useState<CuaState>(INITIAL_CUA_STATE);
  const [stopPending, setStopPending] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const trackerRef = useRef<CuaSurfaceRevisionTracker>(new CuaSurfaceRevisionTracker());
  const [snapshot, setSnapshot] = useState<CuaSurfaceSnapshot>(() => createFailClosedSnapshot(0, { width: 1, height: 1 }, 'unmounted', options.contentRevision));
  const isWorkspaceInert = computeWorkspaceInert({
    isAgentBusy: options.isAgentBusy,
    hasPendingApproval: options.hasPendingApproval,
    cuaPhase: state.phase
  });
  const stateRef = useRef<CuaState>(state);
  const stopPendingRef = useRef<boolean>(stopPending);
  const optionsRef = useRef(options);
  const mountedRef = useRef(false);
  const ackedPrepareKeysRef = useRef<Set<string>>(new Set());
  const rafIdRef = useRef<number | null>(null);

  stateRef.current = state;
  stopPendingRef.current = stopPending;
  optionsRef.current = options;

  const reportSnapshotAsync = useCallback(async (nextSnapshot: CuaSurfaceSnapshot): Promise<boolean> => {
    setSnapshot(nextSnapshot);
    const api = typeof window === 'undefined' ? undefined : window.videoTool;
    if (typeof api?.cuaReportSurfaceSnapshot !== 'function') return true;
    if (nextSnapshot.viewport.width <= 0 || nextSnapshot.viewport.height <= 0) return false;
    try {
      const res = await api.cuaReportSurfaceSnapshot(nextSnapshot);
      return res.ok && res.value.accepted;
    } catch {
      return false;
    }
  }, []);

  const flushSnapshotAsync = useCallback(async (flushOptions?: { readonly force?: boolean }): Promise<CuaSurfaceSnapshot | null> => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    const currentOpts = optionsRef.current;
    const measured = collectDomSurfaceState({
      contentRevision: currentOpts.contentRevision,
      isAgentBusy: currentOpts.isAgentBusy,
      hasPendingApproval: currentOpts.hasPendingApproval,
      cuaPhase: stateRef.current.phase
    });
    const { snapshot: nextSnapshot, changed } = trackerRef.current.next(measured);
    if (changed || flushOptions?.force === true) {
      const ok = await reportSnapshotAsync(nextSnapshot);
      return ok ? nextSnapshot : null;
    }
    return nextSnapshot;
  }, [reportSnapshotAsync]);

  const flushSnapshot = useCallback((): void => {
    void flushSnapshotAsync();
  }, [flushSnapshotAsync]);

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
    if (nextState.phase === 'idle' || nextState.phase === 'ready' || nextState.phase === 'preparing' || nextState.phase === 'acting') {
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
    mountedRef.current = true;

    const initialFailClosed = trackerRef.current.failClosed(
      { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) },
      'initializing',
      optionsRef.current.contentRevision
    );
    void reportSnapshotAsync(initialFailClosed);
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
      mountedRef.current = false;
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
        'unmounted',
        optionsRef.current.contentRevision
      );
      void reportSnapshotAsync(unmountedSnapshot);
    };
  }, [flushSnapshot, reportSnapshotAsync, scheduleSnapshot]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Deterministic prepareAck handshake:
  // When main publishes phase === 'preparing' with (runId, prepareToken), React first
  // commits workspaceInert=false to DOM; then useLayoutEffect verifies the active
  // [data-cua-safe-surface] is non-inert, awaits cuaReportSurfaceSnapshot(executionBlocked: false, contentRevision),
  // and acknowledges once via cuaAckPrepare({ runId, prepareToken }).
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (state.phase !== 'preparing' || state.prepareToken === null || state.runId === null) return;
    const runId = state.runId;
    const prepareToken = state.prepareToken;
    const ackKey = `${runId}:${prepareToken}`;
    if (ackedPrepareKeysRef.current.has(ackKey)) return;

    let cancelled = false;
    void (async () => {
      const safeEl = Array.from(document.querySelectorAll('[data-cua-safe-surface]')).find(
        (el): el is HTMLElement => el instanceof HTMLElement && el.getBoundingClientRect().width > 0
      );
      if (!safeEl || safeEl.closest('[inert],[hidden],[aria-hidden="true"]') !== null) {
        return;
      }
      const reported = await flushSnapshotAsync({ force: true });
      if (cancelled || !mountedRef.current || reported === null) return;
      if (reported.executionBlocked || reported.safeSurface === null || !reported.safeSurface.interactive) {
        return;
      }
      const latest = stateRef.current;
      if (latest.phase !== 'preparing' || latest.runId !== runId || latest.prepareToken !== prepareToken) {
        return;
      }
      if (ackedPrepareKeysRef.current.has(ackKey)) return;
      if (ackedPrepareKeysRef.current.size >= 64) {
        const oldest = ackedPrepareKeysRef.current.values().next().value;
        if (oldest !== undefined) ackedPrepareKeysRef.current.delete(oldest);
      }
      ackedPrepareKeysRef.current.add(ackKey);
      const api = typeof window === 'undefined' ? undefined : window.videoTool;
      if (typeof api?.cuaAckPrepare === 'function') {
        void api.cuaAckPrepare({ runId, prepareToken }).catch(() => undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [flushSnapshotAsync, isWorkspaceInert, state.phase, state.prepareToken, state.runId]);

  // Re-measure whenever page, committed contentRevision, busy/approval flags, or CUA phase changes.
  useEffect(() => {
    flushSnapshot();
  }, [flushSnapshot, options.activePageId, options.contentRevision, options.isAgentBusy, options.hasPendingApproval, state.phase]);

  return useMemo<CuaOverlayController>(
    () => ({
      state,
      stopPending,
      stopError,
      snapshot,
      isActing: state.phase === 'acting',
      isPreparing: state.phase === 'preparing',
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
