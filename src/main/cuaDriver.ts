import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { BrowserWindow, KeyboardInputEvent, MouseInputEvent } from 'electron';
import { CUA_KEYS, type CuaActionRequest, type CuaCancelAck, type CuaFrame, type CuaPoint, type CuaRect, type CuaState, type CuaSurfaceSnapshot } from '../shared/cua';

export interface CuaDriverDependencies {
  readonly getDeviceScaleFactor?: () => number;
  readonly getPendingApproval?: () => Readonly<{ sessionId: string; runId: string; windowId: number; frameId: string; layoutRevision: number }> | null;
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
  private heldZoom: number | null = null;
  private heldKey: KeyboardInputEvent | null = null;
  private cancellation: Promise<CuaState> | null = null;
  private injecting = false;
  private cleanupFailureLatched = false;
  private cancelAck: { token: string; runId: string; resolve: () => void } | null = null;
  private trustedApprovalPanel: CuaRect | null = null;
  private observing = false;
  private state: CuaState;

  constructor(private readonly window: BrowserWindow, private readonly dependencies: CuaDriverDependencies) {
    this.state = { cancelToken: null, targetGone: false, sessionId: null, runId: null, windowId: window.id, phase: 'idle', cursor: null, dragStart: null, target: null, label: null, error: null, cleanupComplete: true, releaseFailures: [] };
    window.on('blur', () => { void this.cancel('blur'); });
    window.on('resize', () => { void this.cancel('resize'); });
    window.on('move', () => { void this.cancel('window-moved'); });
    window.on('closed', () => { void this.cancel('closed'); });
    window.webContents.on('did-start-navigation', () => { void this.cancel('navigation'); });
    window.webContents.on('render-process-gone', () => { void this.cancel('renderer-gone'); });
    window.webContents.on('zoom-changed', () => { void this.cancel('zoom'); });
    window.webContents.on('blur', () => { void this.cancel('contents-blur'); });
    // Electron 43 macOS probe verifies these events fire synchronously inside
    // sendInputEvent. This is a delivery guard, never a renderer isTrusted test.
    window.webContents.on('before-input-event', () => {
      if (!this.injecting && ['acting', 'ready'].includes(this.state.phase)) void this.cancel('user-input');
    });
    window.webContents.on('before-mouse-event', (_event, input) => {
      if (this.injecting || !['acting', 'ready'].includes(this.state.phase)) return;
      const pending = this.dependencies.getPendingApproval?.();
      const frame = this.frame;
      // A validated fixed panel is only a cancellation exception. It neither
      // clears main execution blocking nor issues approval authority.
      if (this.state.phase === 'ready' && this.executionBlocked && pending && frame && this.trustedApprovalPanel
        && pending.sessionId === frame.sessionId && pending.runId === frame.runId && pending.windowId === this.window.id
        && pending.frameId === frame.frameId && pending.layoutRevision === frame.layoutRevision
        && inside({ x: input.x / frame.zoomFactor, y: input.y / frame.zoomFactor }, this.trustedApprovalPanel)) return;
      void this.cancel('user-input');
    });
  }
  getState(): CuaState { return structuredClone(this.state); }
  acknowledgeCancel(ack: CuaCancelAck): boolean {
    if (!ack || this.state.phase !== 'stopping' || !this.cancelAck || ack.runId !== this.cancelAck.runId || ack.cancelToken !== this.cancelAck.token) return false;
    const pending = this.cancelAck; this.cancelAck = null; pending.resolve(); return true;
  }
  setExecutionBlocked(blocked: boolean): void { this.executionBlocked = blocked; }
  private publish(patch: Partial<CuaState>): void {
    this.state = { ...this.state, ...patch };
    // A disappearing renderer must never prevent held-input release.
    try { this.dependencies.onState?.(this.getState()); } catch { /* transport is gone; state remains queryable */ }
  }
  private live(): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) throw new Error('CUA_TARGET_GONE');
    if (!this.window.isFocused() || !this.window.webContents.isFocused()) throw new Error('CUA_NOT_FOCUSED');
  }
  private protectedGeometry(snapshot: CuaSurfaceSnapshot): string {
    const panel = this.trustedApprovalPanel;
    return JSON.stringify(snapshot.protectedRects.filter(p => !(panel && p.kind === 'approval-ui'
      && p.rect.x >= panel.x && p.rect.y >= panel.y
      && p.rect.x + p.rect.width <= panel.x + panel.width && p.rect.y + p.rect.height <= panel.y + panel.height)));
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
      || this.protectedGeometry(snapshot) !== this.protectedGeometry(this.surface));
    this.surface = structuredClone(snapshot);
    if (changed) { this.frame = null; if (this.state.phase === 'acting') void this.cancel('surface-changed'); }
  }
  async observe(context: { sessionId: string; runId: string }): Promise<CuaFrame> {
    this.live();
    if (this.observing || this.state.phase === 'acting' || this.state.phase === 'stopping' || this.cleanupFailureLatched) throw new Error('CUA_BUSY');
    if (!context.sessionId || !context.runId || !this.surface?.safeSurface?.interactive) throw new Error('CUA_UNSAFE_SURFACE');
    this.observing = true;
    this.frame = null;
    try {
    const snapshot = structuredClone(this.surface);
    const revision = this.generation;
    const panel: unknown = await this.window.webContents.executeJavaScript(`(() => {
      const panels = [...document.querySelectorAll('[data-cua-protected="agent-panel"]')].filter(e => e.getBoundingClientRect().width > 0);
      if (panels.length !== 1) return null;
      const r = panels[0].getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height};
    })()`);
    const candidate = panel as CuaRect | null;
    const reported = snapshot.protectedRects.find(p => p.kind === 'agent-panel');
    this.trustedApprovalPanel = candidate && reported && [candidate.x,candidate.y,candidate.width,candidate.height].every(Number.isFinite)
      && candidate.width > 0 && candidate.width <= snapshot.viewport.width / 2
      && ['x','y','width','height'].every(k => Math.abs(candidate[k as keyof CuaRect] - reported.rect[k as keyof CuaRect]) <= 0.5)
      && !crosses({x:candidate.x,y:candidate.y},{x:candidate.x+candidate.width,y:candidate.y+candidate.height},snapshot.safeSurface!.rect)
      ? candidate : null;
    const image = await this.window.webContents.capturePage();
    this.live();
    if (revision !== this.generation || !this.surface || snapshot.layoutRevision !== this.surface.layoutRevision
      || JSON.stringify(snapshot.safeSurface) !== JSON.stringify(this.surface.safeSurface)
      || this.protectedGeometry(snapshot) !== this.protectedGeometry(this.surface)
      || JSON.stringify(snapshot.viewport) !== JSON.stringify(this.surface.viewport)) throw new Error('CUA_STALE_FRAME');
    const png = image.toPNG();
    if (image.isEmpty() || png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('CUA_EMPTY_CAPTURE');
    const bitmap = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    if (bitmap.width <= 0 || bitmap.height <= 0) throw new Error('CUA_EMPTY_CAPTURE');
    const frame: CuaFrame = { ...context, windowId: this.window.id, frameId: randomUUID(), layoutRevision: snapshot.layoutRevision, capturedAt: Date.now(), viewport: snapshot.viewport, bitmap, deviceScaleFactor: this.dependencies.getDeviceScaleFactor?.() ?? 1, zoomFactor: this.window.webContents.getZoomFactor(), pngDataUrl: `data:image/png;base64,${png.toString('base64')}` };
    this.frame = frame; this.frameTime = performance.now(); this.cancellation = null;
    this.publish({ ...context, phase: 'ready', error: null, cleanupComplete: true, releaseFailures: [] });
    return frame;
    } finally { this.observing = false; }
  }
  private validate(request: CuaActionRequest): CuaPoint[] {
    this.live();
    if (this.observing || this.state.phase !== 'ready') throw new Error('CUA_BUSY');
    const f = this.frame, s = this.surface;
    if (!f || !s || request.sessionId !== f.sessionId || request.runId !== f.runId || request.windowId !== this.window.id || request.frameId !== f.frameId || request.layoutRevision !== f.layoutRevision || s.layoutRevision !== f.layoutRevision || performance.now() - this.frameTime > 120000 || this.window.webContents.getZoomFactor() !== f.zoomFactor
      || (this.dependencies.getDeviceScaleFactor?.() ?? 1) !== f.deviceScaleFactor) throw new Error('CUA_STALE_FRAME');
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
    const rawPoints = action.kind === 'click' ? [action.point] : Array.from({ length: 61 }, (_, i) => ({ x: action.from.x + (action.to.x - action.from.x) * i / 60, y: action.from.y + (action.to.y - action.from.y) * i / 60 }));
    // Validate the effective CSS point after Electron's integer DIP rounding.
    const points = rawPoints.map(p => ({ x: Math.round(p.x * f.zoomFactor) / f.zoomFactor, y: Math.round(p.y * f.zoomFactor) / f.zoomFactor }));
    if (action.kind === 'drag' && s.protectedRects.some(r => crosses(points[0]!, points.at(-1)!, r.rect))) throw new Error('CUA_OUT_OF_BOUNDS_OR_PROTECTED');
    for (const p of points) if (!p || !inside(p, { x: 0, y: 0, ...s.viewport }) || !inside(p, s.safeSurface.rect) || s.protectedRects.some(r => inside(p, r.rect))) throw new Error('CUA_OUT_OF_BOUNDS_OR_PROTECTED');
    return points;
  }
  private mouse(type: MouseInputEvent['type'], point: CuaPoint): void {
    const zoom = this.heldZoom ?? this.window.webContents.getZoomFactor();
    this.input({ type, x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1, modifiers: this.heldMouse ? ['leftbuttondown'] : [] });
  }
  private input(event: MouseInputEvent | KeyboardInputEvent): void {
    this.injecting = true;
    try { this.window.webContents.sendInputEvent(event); }
    finally { this.injecting = false; }
  }
  private async verifyDom(request: CuaActionRequest, points: readonly CuaPoint[]): Promise<void> {
    const surface = this.surface;
    if (!surface?.safeSurface) throw new Error('CUA_UNSAFE_SURFACE');
    // Fixed read-only program, never caller-supplied JS. Independently verifies
    // renderer-reported geometry/focus against the bound app document.
    const expected = JSON.stringify({ viewport: surface.viewport, safe: surface.safeSurface, points, key: request.action.kind === 'key' });
    const valid: unknown = await this.window.webContents.executeJavaScript(`(() => {
      const expected = ${expected};
      const close = (a,b) => Math.abs(a-b) <= 0.5;
      if (!close(innerWidth,expected.viewport.width) || !close(innerHeight,expected.viewport.height)) return false;
      if (document.querySelector('[role="dialog"][aria-modal="true"],dialog[open],[role="menu"]')) return false;
      const safe = [...document.querySelectorAll('[data-cua-safe-surface]')].find(e => e.getAttribute('data-cua-safe-surface') === expected.safe.kind && e.getBoundingClientRect().width > 0);
      if (!safe || safe.closest('[inert],[hidden],[aria-hidden="true"]')) return false;
      const r = safe.getBoundingClientRect(), want = expected.safe.rect;
      if (want.x < r.x-0.5 || want.y < r.y-0.5 || want.x+want.width > r.right+0.5 || want.y+want.height > r.bottom+0.5) return false;
      const forbidden = 'iframe,webview,[data-cua-protected],[role="dialog"],[role="menu"],.oc-editor-host__header';
      if (expected.key && (!document.activeElement || !safe.contains(document.activeElement) || document.activeElement.closest(forbidden))) return false;
      return expected.points.every(p => { const e = document.elementFromPoint(p.x,p.y); return e && safe.contains(e) && !e.closest(forbidden); });
    })()`);
    if (valid !== true) throw new Error('CUA_UNSAFE_DOCUMENT');
  }
  async execute(request: CuaActionRequest, permit: unknown, signal?: AbortSignal): Promise<CuaState> {
    let points = this.validate(request);
    await this.verifyDom(request, points);
    // DOM reading is asynchronous: repeat all mutable checks immediately before consume.
    points = this.validate(request);
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
        this.mouse('mouseMove', first); this.heldMouse = first; this.heldZoom = this.window.webContents.getZoomFactor(); this.mouse('mouseDown', first);
        this.publish({ cursor: first, dragStart: request.action.kind === 'drag' ? first : null, target: points.at(-1)! });
        if (request.action.kind === 'drag') for (const p of points.slice(1)) {
          await new Promise(resolve => setTimeout(resolve, request.action.kind === 'drag' ? request.action.durationMs / 60 : 0));
          if (generation !== this.generation || signal?.aborted) throw new Error('CUA_CANCELLED');
          this.live();
          if (this.window.webContents.getZoomFactor() !== this.heldZoom) throw new Error('CUA_STALE_FRAME');
          this.heldMouse = p; this.mouse('mouseMove', p); this.publish({ cursor: p });
        }
      }
      if (generation !== this.generation) throw new Error('CUA_CANCELLED');
      const failures = this.release();
      if (failures.length) this.cleanupFailureLatched = true;
      this.frame = null;
      this.publish({ phase: failures.length ? 'cleanup-failed' : 'ready', cleanupComplete: !failures.length, releaseFailures: failures, error: failures.length ? 'CUA_RELEASE_FAILED' : null, dragStart: null });
      if (failures.length) throw new Error('CUA_RELEASE_FAILED');
      return this.getState();
    } catch (error) { await this.cancel(error instanceof Error ? error.message : 'error'); throw error; }
    finally { signal?.removeEventListener('abort', abort); }
  }
  private release(): string[] {
    const failures: string[] = [];
    if (this.heldMouse) { try { this.mouse('mouseUp', this.heldMouse); this.heldMouse = null; this.heldZoom = null; } catch { failures.push('left'); } }
    if (this.heldKey) { const key = this.heldKey; try { this.input({ ...key, type: 'keyUp' }); this.heldKey = null; } catch { failures.push(key.keyCode); } }
    return failures;
  }
  cancel(reason = 'stopped'): Promise<CuaState> {
    if (this.cancellation) return this.cancellation;
    this.generation++; this.frame = null; this.executionBlocked = true;
    // Assign the promise before callbacks so recursive cancellation is idempotent.
    let settle!: (state: CuaState) => void;
    this.cancellation = new Promise(resolve => { settle = resolve; });
    const needsAck = this.heldMouse !== null && this.state.dragStart !== null && this.state.runId !== null;
    let ackReceived = false;
    let resolveAck!: () => void;
    const ackPromise = new Promise<void>(resolve => { resolveAck = resolve; });
    const token = needsAck ? randomUUID() : null;
    if (token && this.state.runId) this.cancelAck = { token, runId: this.state.runId, resolve: () => { ackReceived = true; resolveAck(); } };
    let revokeFailed = false;
    try { this.dependencies.onCancel?.({ sessionId: this.state.sessionId, runId: this.state.runId, reason }); }
    catch { reason += ':authority-revoke-failed'; revokeFailed = true; }
    this.publish({ phase: 'stopping', error: reason, cleanupComplete: false, cancelToken: token });
    void (async () => {
      if (needsAck) {
        let timeout!: ReturnType<typeof setTimeout>;
        await Promise.race([ackPromise, new Promise<void>(resolve => { timeout = setTimeout(resolve, 200); })]);
        clearTimeout(timeout);
      }
      this.cancelAck = null;
      const failures = this.release(); // Always attempt physical release, even without rollback ack.
      if (needsAck && !ackReceived) failures.push('renderer-rollback-unconfirmed');
      if (revokeFailed) failures.push('authority-revoke');
      if (failures.length) this.cleanupFailureLatched = true;
      const targetGone = this.window.isDestroyed() || this.window.webContents.isDestroyed();
      this.publish({ phase: this.cleanupFailureLatched ? 'cleanup-failed' : 'stopped', targetGone, error: reason, cleanupComplete: !this.cleanupFailureLatched, releaseFailures: failures.length ? failures : this.state.releaseFailures, dragStart: null, cancelToken: null });
      settle(this.getState());
    })();
    return this.cancellation;
  }
}
