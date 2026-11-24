import type { CuaPhase, CuaRect, CuaState, CuaSurfaceSnapshot } from '../../../shared/cua';

export const INITIAL_CUA_STATE: CuaState = {
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
  return phase === 'ready' || phase === 'acting' || phase === 'stopping';
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
  // While CUA is actively executing an approved action, unlock the workspace so
  // webContents.sendInputEvent reaches the editor even while agentChatApprove is
  // still in flight (where isAgentBusy is true and pendingApproval remains set
  // until the approval IPC resolves).
  if (input.cuaPhase === 'acting') return false;
  return input.hasPendingApproval || input.isAgentBusy;
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
  readonly viewport: { readonly width: number; readonly height: number };
  readonly safeSurface: CuaSurfaceSnapshot['safeSurface'];
  readonly protectedRects: readonly CuaProtectedRectEntry[];
  readonly focusedInSafeSurface: boolean;
  readonly focusedTestId: string | null;
  readonly scrollStates: readonly SurfaceScrollState[];
  readonly hasBlockingOverlay: boolean;
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

export function roundRect(rect: { readonly x?: number; readonly left?: number; readonly y?: number; readonly top?: number; readonly width: number; readonly height: number }): CuaRect {
  const x = Math.round(rect.x ?? rect.left ?? 0);
  const y = Math.round(rect.y ?? rect.top ?? 0);
  const width = Math.max(0, Math.round(rect.width));
  const height = Math.max(0, Math.round(rect.height));
  return { x, y, width, height };
}

export function clipRectToViewport(rect: CuaRect, viewport: { readonly width: number; readonly height: number }): CuaRect | null {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(viewport.width, rect.x + rect.width);
  const bottom = Math.min(viewport.height, rect.y + rect.height);
  const width = Math.round(right - left);
  const height = Math.round(bottom - top);
  if (width <= 0 || height <= 0) return null;
  return { x: Math.round(left), y: Math.round(top), width, height };
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

    // If a protected panel/chrome spans across the right edge, trim right boundary.
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

  const width = Math.round(right - left);
  const height = Math.round(bottom - top);
  if (width <= 0 || height <= 0) return null;
  return { x: Math.round(left), y: Math.round(top), width, height };
}

function serializeRect(rect: CuaRect): string {
  return `${rect.x},${rect.y},${rect.width},${rect.height}`;
}

/**
 * Computes a deterministic layout fingerprint used solely to decide whether
 * `layoutRevision` must increment.
 *
 * Key invariant:
 * - Opening an approval card (`approval-ui`) strictly inside a fixed-width,
 *   non-overlapping `agent-panel` does NOT change the effective editor or
 *   protected geometry, so `layoutRevision` remains unchanged.
 * - Changing `agent-panel` width/position, overlapping the safe surface,
 *   resizing the viewport, scrolling inside the safe surface, switching views,
 *   opening/closing modals, or changing focus within the safe surface DOES
 *   change the fingerprint and immediately increments `layoutRevision`.
 */
export function buildSurfaceRevisionKey(measured: MeasuredSurfaceState): string {
  const agentPanels = measured.protectedRects.filter((entry) => entry.kind === 'agent-panel');

  const layoutRelevantProtected = measured.protectedRects
    .filter((entry) => {
      if (entry.kind !== 'approval-ui') return true;
      // If approval-ui is completely contained inside an already-protected agent-panel
      // and does not overlap safeSurface, its appearance inside the fixed-width sidebar
      // does not alter editor/protected geometry.
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

  const focusPart = measured.focusedInSafeSurface
    ? `in:${measured.focusedTestId ?? ''}`
    : 'out';

  return [
    `vp:${Math.round(measured.viewport.width)}x${Math.round(measured.viewport.height)}`,
    `modal:${measured.hasBlockingOverlay ? '1' : '0'}`,
    `safe:${safePart}`,
    `prot:${layoutRelevantProtected.join('|')}`,
    `scroll:${scrollPart}`,
    `focus:${focusPart}`
  ].join(';');
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
    `vp:${snapshot.viewport.width}x${snapshot.viewport.height}`,
    `safe:${safePart}`,
    `prot:${protPart}`,
    `focus:${snapshot.focusedInSafeSurface ? '1' : '0'}:${snapshot.focusedTestId ?? ''}`
  ].join(';');
}

export class CuaSurfaceRevisionTracker {
  private revision = 0;
  private lastRevisionKey: string | null = null;
  private lastDeliveryKey: string | null = null;

  next(measured: MeasuredSurfaceState): { readonly snapshot: CuaSurfaceSnapshot; readonly changed: boolean; readonly revisionChanged: boolean } {
    const revisionKey = buildSurfaceRevisionKey(measured);
    const revisionChanged = this.lastRevisionKey === null || this.lastRevisionKey !== revisionKey;
    if (revisionChanged) {
      this.revision += 1;
      this.lastRevisionKey = revisionKey;
    }

    const snapshot: CuaSurfaceSnapshot = {
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

  failClosed(viewport: { readonly width: number; readonly height: number }): CuaSurfaceSnapshot {
    return this.next({
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

export function createFailClosedSnapshot(layoutRevision: number, viewport = { width: 0, height: 0 }): CuaSurfaceSnapshot {
  return {
    layoutRevision,
    viewport: {
      width: Math.max(0, Math.round(viewport.width)),
      height: Math.max(0, Math.round(viewport.height))
    },
    safeSurface: null,
    protectedRects: [],
    focusedInSafeSurface: false,
    focusedTestId: null
  };
}

export const CUA_VALID_SAFE_KINDS: ReadonlySet<CuaSafeSurfaceKind> = VALID_SAFE_KINDS;
export const CUA_VALID_PROTECTED_KINDS: ReadonlySet<CuaProtectedKind> = VALID_PROTECTED_KINDS;

