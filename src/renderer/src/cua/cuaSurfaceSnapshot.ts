import type { CuaPhase, CuaRect, CuaState, CuaSurfaceSnapshot } from '../../../shared/cua';

export const INITIAL_CUA_STATE: CuaState = {
  postInput: null,
  lastDispatchReceipt: null,
  prepareToken: null,
  cancelToken: null,
  targetGone: false,
  sessionId: null,
  runId: null,
  windowId: 0,
  phase: 'idle',
  cursor: null,
  dragStart: null,
  target: null,
  label: null,
  error: null,
  cleanupComplete: true,
  releaseFailures: []
};

export function isCuaStoppablePhase(phase: CuaPhase): boolean {
  return phase === 'ready' || phase === 'preparing' || phase === 'acting' || phase === 'stopping';
}

export function isCuaStopSettled(state: CuaState): boolean {
  return (
    state.phase === 'idle' ||
    state.phase === 'cleanup-failed' ||
    (state.phase === 'stopped' && state.cleanupComplete)
  );
}

export function computeWorkspaceInert(input: {
  readonly isAgentBusy: boolean;
  readonly hasPendingApproval: boolean;
  readonly cuaPhase: CuaPhase;
}): boolean {
  // Keep workspace non-inert across active CUA lifecycle phases (`ready`,
  // `preparing`, `acting`) so `acting -> ready` never re-attaches `inert` and
  // triggers Chromium `focusout` -> `layoutRevision` / `surface-changed` cancel
  // loops, and real DOM focus is preserved naturally for multi-step key actions.
  // During `ready`, main-process `executionBlocked` + `before-input-event` /
  // `before-mouse-event` guards remain active and cancel on any user input.
  if (input.cuaPhase === 'ready' || input.cuaPhase === 'preparing' || input.cuaPhase === 'acting') return false;
  return input.hasPendingApproval || input.isAgentBusy;
}

export function computeExecutionBlockState(input: {
  readonly isAgentBusy: boolean;
  readonly hasPendingApproval: boolean;
  readonly hasBlockingOverlay: boolean;
  readonly hasSafeSurface: boolean;
  readonly cuaPhase: CuaPhase;
}): { readonly executionBlocked: boolean; readonly blockReason: string | null } {
  if (input.hasBlockingOverlay) {
    return { executionBlocked: true, blockReason: 'blocking-overlay' };
  }
  if (!input.hasSafeSurface) {
    return { executionBlocked: true, blockReason: 'no-safe-surface' };
  }
  if (input.cuaPhase === 'cleanup-failed') {
    return { executionBlocked: true, blockReason: 'cleanup-failed' };
  }
  if (input.cuaPhase === 'stopping') {
    return { executionBlocked: true, blockReason: 'stopping' };
  }
  if (input.cuaPhase === 'preparing' || input.cuaPhase === 'acting') {
    return { executionBlocked: false, blockReason: null };
  }
  if (input.hasPendingApproval) {
    return { executionBlocked: true, blockReason: 'pending-approval' };
  }
  if (input.isAgentBusy) {
    return { executionBlocked: true, blockReason: 'agent-busy' };
  }
  return { executionBlocked: false, blockReason: null };
}

export type CuaSafeSurfaceKind = NonNullable<CuaSurfaceSnapshot['safeSurface']>['kind'];
export type CuaProtectedKind = CuaSurfaceSnapshot['protectedRects'][number]['kind'];
export type CuaProtectedRectEntry = CuaSurfaceSnapshot['protectedRects'][number];

export interface SurfaceScrollState {
  readonly id: string;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

export interface MeasuredSurfaceState {
  readonly contentRevision: number;
  readonly executionBlocked: boolean;
  readonly blockReason: string | null;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly safeSurface: CuaSurfaceSnapshot['safeSurface'];
  readonly protectedRects: readonly CuaProtectedRectEntry[];
  readonly focusedInSafeSurface: boolean;
  readonly focusedTestId: string | null;
  readonly scrollStates: readonly SurfaceScrollState[];
  readonly hasBlockingOverlay: boolean;
  /** True while CUA driver is actively injecting pointer/key events so its own mousedown focus does not self-cancel mid-drag. */
  readonly cuaActing?: boolean;
}

const VALID_SAFE_KINDS = new Set<CuaSafeSurfaceKind>(['timeline', 'canvas', 'shorts-review']);
const VALID_PROTECTED_KINDS = new Set<CuaProtectedKind>([
  'stop-button',
  'approval-ui',
  'agent-panel',
  'settings',
  'chrome-menu',
  'modal'
]);

function precision2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundRect(rect: { readonly x?: number; readonly left?: number; readonly y?: number; readonly top?: number; readonly width: number; readonly height: number }): CuaRect {
  const x = precision2(rect.x ?? rect.left ?? 0);
  const y = precision2(rect.y ?? rect.top ?? 0);
  const width = Math.max(0, precision2(rect.width));
  const height = Math.max(0, precision2(rect.height));
  return { x, y, width, height };
}

export function clipRectToViewport(rect: CuaRect, viewport: { readonly width: number; readonly height: number }): CuaRect | null {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(viewport.width, rect.x + rect.width);
  const bottom = Math.min(viewport.height, rect.y + rect.height);
  const width = precision2(right - left);
  const height = precision2(bottom - top);
  if (width <= 0 || height <= 0) return null;
  return { x: precision2(left), y: precision2(top), width, height };
}

export function rectContains(outer: CuaRect, inner: CuaRect, tolerancePx = 1): boolean {
  return (
    inner.x >= outer.x - tolerancePx &&
    inner.y >= outer.y - tolerancePx &&
    inner.x + inner.width <= outer.x + outer.width + tolerancePx &&
    inner.y + inner.height <= outer.y + outer.height + tolerancePx
  );
}

export function rectsOverlap(a: CuaRect, b: CuaRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Trims edge-docked overlapping protected rects (such as a right-hand agent panel
 * or top chrome bar) out of the candidate safe surface rect. Returns null if the
 * safe surface is fully covered or reduced to zero area.
 */
export function excludeProtectedFromSafeSurface(
  candidate: CuaRect,
  protectedRects: readonly CuaProtectedRectEntry[]
): CuaRect | null {
  let left = candidate.x;
  let top = candidate.y;
  let right = candidate.x + candidate.width;
  let bottom = candidate.y + candidate.height;

  for (const entry of protectedRects) {
    if (entry.kind === 'modal' || entry.kind === 'settings') {
      return null;
    }
    const rect = entry.rect;
    const current: CuaRect = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    if (current.width <= 0 || current.height <= 0) return null;
    if (!rectsOverlap(current, rect)) continue;

    if (rectContains(rect, current)) {
      return null;
    }

    const coversHeight = rect.y <= top + 2 && rect.y + rect.height >= bottom - 2;
    const coversWidth = rect.x <= left + 2 && rect.x + rect.width >= right - 2;
    if (coversHeight && rect.x > left && rect.x < right) {
      right = Math.min(right, rect.x);
    } else if (coversHeight && rect.x <= left && rect.x + rect.width < right) {
      left = Math.max(left, rect.x + rect.width);
    } else if (coversWidth && rect.y <= top && rect.y + rect.height < bottom) {
      top = Math.max(top, rect.y + rect.height);
    } else if (coversWidth && rect.y > top && rect.y < bottom) {
      bottom = Math.min(bottom, rect.y);
    }
  }

  const width = precision2(right - left);
  const height = precision2(bottom - top);
  if (width <= 0 || height <= 0) return null;
  return { x: precision2(left), y: precision2(top), width, height };
}

function serializeRect(rect: CuaRect): string {
  return `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`;
}

/**
 * Computes a deterministic layout fingerprint used solely to decide whether
 * `layoutRevision` must increment.
 *
 * Key invariant:
 * - Opening an approval card (`approval-ui`) strictly inside a fixed-width,
 *   non-overlapping `agent-panel` does NOT change the effective editor or
 *   protected geometry, so `layoutRevision` remains unchanged.
 * - Changing `executionBlocked`/`blockReason` alone does NOT increment
 *   `layoutRevision` (mirrors `CuaDriver.reportSurface` which keeps the bound
 *   frame across `executionBlocked` transitions).
 * - Changing `agent-panel` width/position, overlapping the safe surface,
 *   resizing the viewport, scrolling inside the safe surface, switching views,
 *   opening/closing modals, or changing focus within the safe surface DOES
 *   change the fingerprint and immediately increments `layoutRevision`.
 */
export function buildSurfaceGeometryKey(measured: MeasuredSurfaceState): string {
  const agentPanels = measured.protectedRects.filter((entry) => entry.kind === 'agent-panel');

  const layoutRelevantProtected = measured.protectedRects
    .filter((entry) => {
      if (entry.kind !== 'approval-ui') return true;
      const containedInAgentPanel = agentPanels.some((panel) => rectContains(panel.rect, entry.rect));
      const overlapsSafe = measured.safeSurface !== null && rectsOverlap(measured.safeSurface.rect, entry.rect);
      return !containedInAgentPanel || overlapsSafe;
    })
    .map((entry) => `${entry.id}:${entry.kind}:${serializeRect(entry.rect)}`)
    .sort();

  const safePart = measured.safeSurface === null
    ? 'null'
    : `${measured.safeSurface.kind}:${serializeRect(measured.safeSurface.rect)}`;

  const scrollPart = measured.scrollStates
    .map((entry) => `${entry.id}:${Math.round(entry.scrollLeft)},${Math.round(entry.scrollTop)}`)
    .sort()
    .join('|');

  return [
    `vp:${Math.round(measured.viewport.width)}x${Math.round(measured.viewport.height)}`,
    `modal:${measured.hasBlockingOverlay ? '1' : '0'}`,
    `safe:${safePart}`,
    `prot:${layoutRelevantProtected.join('|')}`,
    `scroll:${scrollPart}`
  ].join(';');
}

export function buildSurfaceFocusKey(measured: MeasuredSurfaceState): string {
  // Track only safe-surface containment (not intra-safe-surface focusedTestId)
  // so clicking/focusing different clips inside the same safe surface does not
  // bump layoutRevision while leaving the safe surface always bumps it.
  return measured.focusedInSafeSurface ? 'in' : 'out';
}

export function buildSurfaceRevisionKey(measured: MeasuredSurfaceState): string {
  return `${buildSurfaceGeometryKey(measured)};focus:${buildSurfaceFocusKey(measured)}`;
}

export function buildSnapshotDeliveryKey(snapshot: CuaSurfaceSnapshot): string {
  const safePart = snapshot.safeSurface === null
    ? 'null'
    : `${snapshot.safeSurface.kind}:${serializeRect(snapshot.safeSurface.rect)}:${snapshot.safeSurface.interactive ? '1' : '0'}`;
  const protPart = snapshot.protectedRects
    .map((entry) => `${entry.id}:${entry.kind}:${serializeRect(entry.rect)}`)
    .sort()
    .join('|');
  return [
    `rev:${snapshot.layoutRevision}`,
    `crev:${snapshot.contentRevision}`,
    `blk:${snapshot.executionBlocked ? '1' : '0'}:${snapshot.blockReason ?? ''}`,
    `vp:${snapshot.viewport.width}x${snapshot.viewport.height}`,
    `safe:${safePart}`,
    `prot:${protPart}`,
    `focus:${snapshot.focusedInSafeSurface ? '1' : '0'}:${snapshot.focusedTestId ?? ''}`
  ].join(';');
}

export class CuaSurfaceRevisionTracker {
  private revision = 0;
  private contentRevisionFloor = 0;
  private lastGeometryKey: string | null = null;
  private lastFocusedInSafeSurface: boolean | null = null;
  private lastDeliveryKey: string | null = null;

  next(measured: MeasuredSurfaceState): { readonly snapshot: CuaSurfaceSnapshot; readonly changed: boolean; readonly revisionChanged: boolean } {
    const geometryKey = buildSurfaceGeometryKey(measured);
    const geometryChanged = this.lastGeometryKey === null || this.lastGeometryKey !== geometryKey;
    const focusLeftSafeSurface = this.lastFocusedInSafeSurface === true && !measured.focusedInSafeSurface;
    const focusEnteredSafeSurfaceIdle =
      this.lastFocusedInSafeSurface === false &&
      measured.focusedInSafeSurface &&
      measured.cuaActing !== true;
    // - Geometry / scroll / modal / view / protectedRects changes ALWAYS bump revision.
    // - Focus leaving the safe surface (into protected or outside area) ALWAYS bumps revision.
    // - Intra-safe-surface focus moves (clip A -> clip B, lane -> clip) NEVER bump revision.
    // - CUA's own mousedown focusing into safeSurface during acting does not self-cancel mid-drag.
    const revisionChanged = geometryChanged || focusLeftSafeSurface || focusEnteredSafeSurfaceIdle;
    if (revisionChanged) {
      this.revision += 1;
    }
    this.lastGeometryKey = geometryKey;
    this.lastFocusedInSafeSurface = measured.focusedInSafeSurface;

    const normalizedContentRevision = Math.max(
      this.contentRevisionFloor,
      Number.isSafeInteger(measured.contentRevision) && measured.contentRevision >= 0 ? measured.contentRevision : 0
    );
    this.contentRevisionFloor = normalizedContentRevision;

    const snapshot: CuaSurfaceSnapshot = {
      contentRevision: normalizedContentRevision,
      executionBlocked: measured.executionBlocked,
      blockReason: measured.blockReason,
      layoutRevision: this.revision,
      viewport: {
        width: Math.max(0, Math.round(measured.viewport.width)),
        height: Math.max(0, Math.round(measured.viewport.height))
      },
      safeSurface: measured.safeSurface,
      protectedRects: measured.protectedRects,
      focusedInSafeSurface: measured.focusedInSafeSurface,
      focusedTestId: measured.focusedInSafeSurface ? measured.focusedTestId : null
    };

    const deliveryKey = buildSnapshotDeliveryKey(snapshot);
    const changed = this.lastDeliveryKey === null || this.lastDeliveryKey !== deliveryKey;
    if (changed) {
      this.lastDeliveryKey = deliveryKey;
    }

    return { snapshot, changed, revisionChanged };
  }

  failClosed(
    viewport: { readonly width: number; readonly height: number },
    blockReason = 'surface-unavailable',
    contentRevision = this.contentRevisionFloor
  ): CuaSurfaceSnapshot {
    return this.next({
      contentRevision,
      executionBlocked: true,
      blockReason,
      viewport,
      safeSurface: null,
      protectedRects: [],
      focusedInSafeSurface: false,
      focusedTestId: null,
      scrollStates: [],
      hasBlockingOverlay: true
    }).snapshot;
  }

  get currentRevision(): number {
    return this.revision;
  }
}

export function createFailClosedSnapshot(
  layoutRevision: number,
  viewport = { width: 1, height: 1 },
  blockReason = 'unmounted',
  contentRevision = 0
): CuaSurfaceSnapshot {
  return {
    contentRevision: Math.max(0, Math.round(contentRevision)),
    executionBlocked: true,
    blockReason,
    layoutRevision,
    viewport: {
      width: Math.max(1, Math.round(viewport.width)),
      height: Math.max(1, Math.round(viewport.height))
    },
    safeSurface: null,
    protectedRects: [],
    focusedInSafeSurface: false,
    focusedTestId: null
  };
}

export const CUA_VALID_SAFE_KINDS: ReadonlySet<CuaSafeSurfaceKind> = VALID_SAFE_KINDS;
export const CUA_VALID_PROTECTED_KINDS: ReadonlySet<CuaProtectedKind> = VALID_PROTECTED_KINDS;
