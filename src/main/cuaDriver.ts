import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { BrowserWindow, KeyboardInputEvent, MouseInputEvent } from 'electron';
import { CUA_KEYS, type CuaActionRequest, type CuaFrame, type CuaPoint, type CuaRect, type CuaState, type CuaSurfaceSnapshot } from '../shared/cua';

export interface CuaDriverDependencies {
  readonly consumePermit: (request: CuaActionRequest, permit: unknown) => void;
  readonly onCancel?: (context: { sessionId: string | null; runId: string | null; reason: string }) => void;
  readonly onState?: (state: CuaState) => void;
}
const inside = (p: CuaPoint, r: CuaRect): boolean => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;
function crosses(a: CuaPoint, b: CuaPoint, r: CuaRect): boolean {
  let lo = 0, hi = 1;
  for (const [origin, delta, min, max] of [[a.x, b.x - a.x, r.x, r.x + r.width], [a.y, b.y - a.y, r.y, r.y + r.height]]) {
    if (origin === undefined || delta === undefined || min === undefined || max === undefined) return true;
    if (delta === 0) { if (origin < min || origin > max) return false; continue; }
    const t0 = (min - origin) / delta, t1 = (max - origin) / delta;
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
    if (lo > hi) return false;
  }
  return true;
}

/** Holds only the explicitly supplied app window; never discovers OS windows. */
export class CuaDriver {
  private surface: CuaSurfaceSnapshot | null = null;
  private frame: CuaFrame | null = null;
  private frameTime = 0;
  private executionBlocked = true;
  private generation = 0;
  private heldMouse: CuaPoint | null = null;
  private heldKey: KeyboardInputEvent | null = null;
  private cancellation: Promise<CuaState> | null = null;
  private injecting = false;
  private state: CuaState;

  constructor(private readonly window: BrowserWindow, private readonly dependencies: CuaDriverDependencies) {
    this.state = { sessionId: null, runId: null, windowId: window.id, phase: 'idle', cursor: null, dragStart: null, target: null, label: null, error: null, cleanupComplete: true, releaseFailures: [] };
    window.on('blur', () => { void this.cancel('blur'); });
    window.on('resize', () => { void this.cancel('resize'); });
    window.on('closed', () => { void this.cancel('closed'); });
    window.webContents.on('did-start-navigation', () => { void this.cancel('navigation'); });
    window.webContents.on('render-process-gone', () => { void this.cancel('renderer-gone'); });
    window.webContents.on('zoom-changed', () => { void this.cancel('zoom'); });
    window.webContents.on('blur', () => { void this.cancel('contents-blur'); });
    // Electron 43 macOS probe verifies these events fire synchronously inside
    // sendInputEvent. This is a delivery guard, never a renderer isTrusted test.
    window.webContents.on('before-input-event', () => {
      if (!this.injecting && this.state.phase === 'acting') void this.cancel('user-input');
    });
    window.webContents.on('before-mouse-event', () => {
      if (!this.injecting && this.state.phase === 'acting') void this.cancel('user-input');
    });
  }
  getState(): CuaState { return structuredClone(this.state); }
  setExecutionBlocked(blocked: boolean): void { this.executionBlocked = blocked; }
  private publish(patch: Partial<CuaState>): void { this.state = { ...this.state, ...patch }; this.dependencies.onState?.(this.getState()); }
  private live(): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) throw new Error('CUA_TARGET_GONE');
    if (!this.window.isFocused() || !this.window.webContents.isFocused()) throw new Error('CUA_NOT_FOCUSED');
  }
  reportSurface(snapshot: CuaSurfaceSnapshot): void {
    // Runtime validation is mandatory: the bridge does not make renderer data trusted.
    if (!snapshot || !Number.isSafeInteger(snapshot.layoutRevision) || snapshot.layoutRevision < 0
      || typeof snapshot.executionBlocked !== 'boolean' || typeof snapshot.focusedInSafeSurface !== 'boolean'
      || !snapshot.viewport || ![snapshot.viewport.width, snapshot.viewport.height].every(n => Number.isFinite(n) && n > 0 && n < 32768)
      || !Array.isArray(snapshot.protectedRects) || snapshot.protectedRects.length > 256) throw new Error('CUA_INVALID_SURFACE');
    const validRect = (r: CuaRect): boolean => !!r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 0 && r.height >= 0;
    if (snapshot.protectedRects.some(p => !p || !validRect(p.rect)) || (snapshot.safeSurface !== null && (!validRect(snapshot.safeSurface.rect) || typeof snapshot.safeSurface.interactive !== 'boolean'))) throw new Error('CUA_INVALID_SURFACE');
    if (this.surface && snapshot.layoutRevision < this.surface.layoutRevision) throw new Error('CUA_STALE_SURFACE');
    const changed = this.surface !== null && (snapshot.layoutRevision !== this.surface.layoutRevision
      || JSON.stringify(snapshot.viewport) !== JSON.stringify(this.surface.viewport)
      || JSON.stringify(snapshot.safeSurface) !== JSON.stringify(this.surface.safeSurface)
      || JSON.stringify(snapshot.protectedRects) !== JSON.stringify(this.surface.protectedRects));
    this.surface = structuredClone(snapshot);
    if (changed) { this.frame = null; if (this.state.phase === 'acting') void this.cancel('surface-changed'); }
  }
  async observe(context: { sessionId: string; runId: string }): Promise<CuaFrame> {
    this.live();
    if (this.state.phase === 'acting' || this.state.phase === 'stopping' || this.state.phase === 'cleanup-failed') throw new Error('CUA_BUSY');
    if (!context.sessionId || !context.runId || !this.surface?.safeSurface?.interactive) throw new Error('CUA_UNSAFE_SURFACE');
    const snapshot = structuredClone(this.surface);
    const revision = this.generation;
    const image = await this.window.webContents.capturePage();
    this.live();
    if (revision !== this.generation || !this.surface || snapshot.layoutRevision !== this.surface.layoutRevision
      || JSON.stringify(snapshot.safeSurface) !== JSON.stringify(this.surface.safeSurface)
      || JSON.stringify(snapshot.protectedRects) !== JSON.stringify(this.surface.protectedRects)
      || JSON.stringify(snapshot.viewport) !== JSON.stringify(this.surface.viewport)) throw new Error('CUA_STALE_FRAME');
    const bitmap = image.getSize();
    if (image.isEmpty() || bitmap.width <= 0 || bitmap.height <= 0) throw new Error('CUA_EMPTY_CAPTURE');
    const frame: CuaFrame = { ...context, windowId: this.window.id, frameId: randomUUID(), layoutRevision: snapshot.layoutRevision, capturedAt: Date.now(), viewport: snapshot.viewport, bitmap, deviceScaleFactor: bitmap.width / snapshot.viewport.width / this.window.webContents.getZoomFactor(), zoomFactor: this.window.webContents.getZoomFactor(), pngDataUrl: image.toDataURL() };
    this.frame = frame; this.frameTime = performance.now(); this.cancellation = null;
    this.publish({ ...context, phase: 'ready', error: null, cleanupComplete: true, releaseFailures: [] });
    return frame;
  }
  private validate(request: CuaActionRequest): CuaPoint[] {
    this.live();
    if (this.state.phase !== 'ready') throw new Error('CUA_BUSY');
    const f = this.frame, s = this.surface;
    if (!f || !s || request.sessionId !== f.sessionId || request.runId !== f.runId || request.windowId !== this.window.id || request.frameId !== f.frameId || request.layoutRevision !== f.layoutRevision || s.layoutRevision !== f.layoutRevision || performance.now() - this.frameTime > 120000 || this.window.webContents.getZoomFactor() !== f.zoomFactor) throw new Error('CUA_STALE_FRAME');
    if (this.executionBlocked || s.executionBlocked || !s.safeSurface?.interactive) throw new Error('CUA_EXECUTION_BLOCKED');
    const action = request.action;
    if (!action || !['click', 'drag', 'key'].includes(action.kind)) throw new Error('CUA_INVALID_ACTION');
    if (action.kind === 'key') {
      if (!s.focusedInSafeSurface || !CUA_KEYS.includes(action.key) || !Array.isArray(action.modifiers)
        || action.modifiers.length > 1 || action.modifiers.some(m => !['shift', 'control', 'meta', 'alt'].includes(m))
        || (action.modifiers.length > 0 && !(['z', 'y'].includes(action.key) && ['control', 'meta'].includes(action.modifiers[0]!)))) throw new Error('CUA_UNSAFE_KEY');
      return [];
    }
    if (action.kind === 'drag' && (!Number.isFinite(action.durationMs) || action.durationMs < 100 || action.durationMs > 3000)) throw new Error('CUA_INVALID_ACTION');
    if (action.kind === 'drag' && s.protectedRects.some(r => crosses(action.from, action.to, r.rect))) throw new Error('CUA_OUT_OF_BOUNDS_OR_PROTECTED');
    const points = action.kind === 'click' ? [action.point] : Array.from({ length: 61 }, (_, i) => ({ x: action.from.x + (action.to.x - action.from.x) * i / 60, y: action.from.y + (action.to.y - action.from.y) * i / 60 }));
    for (const p of points) if (!p || !inside(p, { x: 0, y: 0, ...s.viewport }) || !inside(p, s.safeSurface.rect) || s.protectedRects.some(r => inside(p, r.rect))) throw new Error('CUA_OUT_OF_BOUNDS_OR_PROTECTED');
    return points;
  }
  private mouse(type: MouseInputEvent['type'], point: CuaPoint): void {
    this.input({ type, x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1, modifiers: this.heldMouse ? ['leftbuttondown'] : [] });
  }
  private input(event: MouseInputEvent | KeyboardInputEvent): void {
    this.injecting = true;
    try { this.window.webContents.sendInputEvent(event); }
    finally { this.injecting = false; }
  }
  async execute(request: CuaActionRequest, permit: unknown, signal?: AbortSignal): Promise<CuaState> {
    const points = this.validate(request);
    if (signal?.aborted) throw new Error('CUA_CANCELLED');
    this.dependencies.consumePermit(request, permit); // No await between validation, one-use consume and first input.
    const generation = this.generation;
    const abort = (): void => { void this.cancel('aborted'); };
    signal?.addEventListener('abort', abort, { once: true });
    this.publish({ phase: 'acting', cleanupComplete: false, label: request.action.kind });
    try {
      if (request.action.kind === 'key') {
        this.heldKey = { type: 'keyDown', keyCode: request.action.key, modifiers: [...request.action.modifiers] };
        this.input(this.heldKey);
      } else {
        const first = points[0]!;
        this.mouse('mouseMove', first); this.heldMouse = first; this.mouse('mouseDown', first);
        this.publish({ cursor: first, dragStart: request.action.kind === 'drag' ? first : null, target: points.at(-1)! });
        if (request.action.kind === 'drag') for (const p of points.slice(1)) {
          await new Promise(resolve => setTimeout(resolve, request.action.kind === 'drag' ? request.action.durationMs / 60 : 0));
          if (generation !== this.generation || signal?.aborted) throw new Error('CUA_CANCELLED');
          this.live();
          this.heldMouse = p; this.mouse('mouseMove', p); this.publish({ cursor: p });
        }
      }
      if (generation !== this.generation) throw new Error('CUA_CANCELLED');
      const failures = this.release();
      this.frame = null;
      this.publish({ phase: failures.length ? 'cleanup-failed' : 'ready', cleanupComplete: !failures.length, releaseFailures: failures, error: failures.length ? 'CUA_RELEASE_FAILED' : null, dragStart: null });
      if (failures.length) throw new Error('CUA_RELEASE_FAILED');
      return this.getState();
    } catch (error) { await this.cancel(error instanceof Error ? error.message : 'error'); throw error; }
    finally { signal?.removeEventListener('abort', abort); }
  }
  private release(): string[] {
    const failures: string[] = [];
    if (this.heldMouse) { try { this.mouse('mouseUp', this.heldMouse); this.heldMouse = null; } catch { failures.push('left'); } }
    if (this.heldKey) { const key = this.heldKey; try { this.input({ ...key, type: 'keyUp' }); this.heldKey = null; } catch { failures.push(key.keyCode); } }
    return failures;
  }
  cancel(reason = 'stopped'): Promise<CuaState> {
    if (this.cancellation) return this.cancellation;
    this.generation++; this.frame = null; this.executionBlocked = true;
    // Assign the promise before callbacks so recursive cancellation is idempotent.
    let settle!: (state: CuaState) => void;
    this.cancellation = new Promise(resolve => { settle = resolve; });
    this.publish({ phase: 'stopping', error: reason, cleanupComplete: false });
    try { this.dependencies.onCancel?.({ sessionId: this.state.sessionId, runId: this.state.runId, reason }); }
    catch { reason += ':authority-revoke-failed'; }
    const failures = this.release();
    this.publish({ phase: failures.length ? 'cleanup-failed' : 'stopped', error: reason, cleanupComplete: failures.length === 0, releaseFailures: failures, dragStart: null });
    settle(this.getState());
    return this.cancellation;
  }
}
