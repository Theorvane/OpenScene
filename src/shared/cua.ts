/** Desktop self-window CUA v1. All positions are viewport CSS pixels. */
export interface CuaPoint { readonly x: number; readonly y: number }
export interface CuaRect extends CuaPoint { readonly width: number; readonly height: number }
export interface CuaSurfaceSnapshot {
  readonly executionBlocked: boolean;
  readonly blockReason: string | null;
  readonly layoutRevision: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly safeSurface: { readonly kind: 'timeline' | 'canvas' | 'shorts-review'; readonly rect: CuaRect; readonly interactive: boolean } | null;
  readonly protectedRects: readonly { readonly id: string; readonly kind: 'stop-button' | 'approval-ui' | 'agent-panel' | 'settings' | 'chrome-menu' | 'modal'; readonly rect: CuaRect }[];
  readonly focusedInSafeSurface: boolean;
  readonly focusedTestId: string | null;
}
export interface CuaFrame {
  readonly sessionId: string;
  readonly runId: string;
  readonly windowId: number;
  readonly frameId: string;
  readonly layoutRevision: number;
  readonly capturedAt: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly bitmap: { readonly width: number; readonly height: number };
  readonly deviceScaleFactor: number;
  readonly zoomFactor: number;
  readonly pngDataUrl: string;
}
export const CUA_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace', 'Space', 'z', 'y'] as const;
export type CuaKey = typeof CUA_KEYS[number];
export type CuaAction =
  | { readonly kind: 'click'; readonly point: CuaPoint }
  | { readonly kind: 'drag'; readonly from: CuaPoint; readonly to: CuaPoint; readonly durationMs: number }
  | { readonly kind: 'key'; readonly key: CuaKey; readonly modifiers: readonly ('shift' | 'control' | 'meta' | 'alt')[] };
/** Main-only approval issuer binds a one-use permit to this exact request. */
export interface CuaActionRequest {
  readonly sessionId: string;
  readonly runId: string;
  readonly windowId: number;
  readonly frameId: string;
  readonly layoutRevision: number;
  readonly action: CuaAction;
}
export type CuaPhase = 'idle' | 'ready' | 'acting' | 'stopping' | 'stopped' | 'cleanup-failed';
export interface CuaState {
  /** Present only while a held drag awaits synchronous renderer rollback. */
  readonly cancelToken: string | null;
  readonly targetGone: boolean;
  readonly sessionId: string | null;
  readonly runId: string | null;
  readonly windowId: number;
  readonly phase: CuaPhase;
  readonly cursor: CuaPoint | null;
  readonly dragStart: CuaPoint | null;
  readonly target: CuaPoint | null;
  readonly label: string | null;
  readonly error: string | null;
  readonly cleanupComplete: boolean;
  readonly releaseFailures: readonly string[];
}
export interface CuaStopResult { readonly accepted: boolean }
export interface CuaCancelAck { readonly runId: string; readonly cancelToken: string }

/** Pixel conversion uses the actual returned bitmap, never DPR alone. */
export function cuaBitmapPointToViewport(frame: Pick<CuaFrame, 'bitmap' | 'viewport'>, point: CuaPoint): CuaPoint {
  if (![point.x, point.y, frame.bitmap.width, frame.bitmap.height, frame.viewport.width, frame.viewport.height].every(Number.isFinite)
    || frame.bitmap.width <= 0 || frame.bitmap.height <= 0 || frame.viewport.width <= 0 || frame.viewport.height <= 0
    || point.x < 0 || point.y < 0 || point.x >= frame.bitmap.width || point.y >= frame.bitmap.height) throw new Error('CUA_OUT_OF_BOUNDS');
  return { x: point.x * frame.viewport.width / frame.bitmap.width, y: point.y * frame.viewport.height / frame.bitmap.height };
}
