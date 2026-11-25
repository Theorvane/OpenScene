import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { BrowserWindow, KeyboardInputEvent, MouseInputEvent } from 'electron';
import { CUA_KEYS, type CuaActionSettlementAck, type CuaActionSettlementTag, type CuaDispatchReceipt, type CuaReleaseFailure, type CuaActionRequest, type CuaCancelAck, type CuaFrame, type CuaKey, type CuaPoint, type CuaPrepareAck, type CuaRect, type CuaState, type CuaSurfaceSnapshot } from '../shared/cua';

export type CuaFrameScope = Pick<CuaFrame, 'sessionId' | 'runId' | 'windowId' | 'frameId' | 'layoutRevision' | 'contentRevision'>;
export type CuaFrameMetadata = Omit<CuaFrame, 'pngDataUrl'>;
export interface CuaObservationLease {
  readonly frame: CuaFrameMetadata;
  readonly signal: AbortSignal;
  getCurrentFrame(): CuaFrameMetadata | null;
  release(): void;
}

const ELECTRON_KEY_CODES: Readonly<Partial<Record<CuaKey, string>>> = {
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down'
};

export interface CuaDriverDependencies {
  readonly isObservationInFlight?: (scope: { sessionId: string; runId: string }) => boolean;
  readonly getDeviceScaleFactor?: () => number;
  readonly getPendingApproval?: () => Readonly<{ sessionId: string; runId: string; windowId: number; frameId: string; layoutRevision: number }> | null;
  readonly consumePermit: (request: CuaActionRequest, permit: unknown) => void;
  readonly checkPermit: (request: CuaActionRequest, permit: unknown) => void;
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
  private receipt: CuaDispatchReceipt | null = null;
  private normalRelease = false;
  private physicalRelease: Promise<void> | null = null;
  private postInput: {
    tag: CuaActionSettlementTag; stage: 'prepared' | 'armed' | 'released'; triggerAttempted: boolean;
    reported: { layoutRevision: number; contentRevision: number } | null;
    resolve: (accepted: boolean) => void;
  } | null = null;
  private observationLease: { controller: AbortController; settled: Promise<void> } | null = null;
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
  private prepareAck: { token: string; request: CuaActionRequest; resolve: (accepted: boolean) => void } | null = null;
  private state: CuaState;

  constructor(private readonly window: BrowserWindow, private readonly dependencies: CuaDriverDependencies) {
    this.state = { postInput: null, lastDispatchReceipt: null, prepareToken: null, cancelToken: null, targetGone: false, sessionId: null, runId: null, windowId: window.id, phase: 'idle', cursor: null, dragStart: null, target: null, label: null, error: null, cleanupComplete: true, releaseFailures: [] };
    window.on('blur', () => { void this.cancel('blur'); });
    window.on('resize', () => { void this.cancel('resize'); });
    window.on('move', () => { void this.cancel('window-moved'); });
    window.on('closed', () => { this.markTargetGone('closed'); });
    window.webContents.on('did-start-navigation', () => { void this.cancel('navigation'); });
    window.webContents.on('render-process-gone', () => { this.markTargetGone('renderer-gone'); });
    window.webContents.on('zoom-changed', () => { void this.cancel('zoom'); });
    window.webContents.on('blur', () => { void this.cancel('contents-blur'); });
    // Electron 43 macOS probe verifies these events fire synchronously inside
    // sendInputEvent. This is a delivery guard, never a renderer isTrusted test.
    window.webContents.on('before-input-event', () => {
      if (!this.injecting && ['acting', 'preparing', 'ready'].includes(this.state.phase)) void this.cancel('user-input');
    });
    window.webContents.on('before-mouse-event', (_event, input) => {
      if (this.injecting || !['acting', 'preparing', 'ready'].includes(this.state.phase)) return;
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
  getLastDispatchReceipt(scope: { sessionId: string; runId: string; actionId?: string }): CuaDispatchReceipt | null {
    const receipt = this.receipt;
    return receipt && receipt.sessionId === scope.sessionId && receipt.runId === scope.runId
      && (scope.actionId === undefined || receipt.actionId === scope.actionId) ? structuredClone(receipt) : null;
  }
  private updateReceipt(patch: Partial<CuaDispatchReceipt>, notify = true): void {
    if (!this.receipt) return;
    this.receipt = { ...this.receipt, ...patch };
    const r = this.receipt;
    this.receipt = { ...r, dispatch: r.attemptedEvents === 0 ? 'no-dispatch'
      : r.attemptedEvents === r.expectedEvents && r.returnedEvents === r.expectedEvents && !r.dispatchUncertain
        && r.release.heldInputCount === 0 && !r.release.failures.length ? 'full-dispatch' : 'partial-dispatch' };
    this.state = { ...this.state, lastDispatchReceipt: structuredClone(this.receipt) };
    if (notify) this.publish({ lastDispatchReceipt: structuredClone(this.receipt) });
  }
  private matchesSettlement(tag: CuaActionSettlementTag): boolean {
    const pending = this.postInput;
    return !!pending && !!tag && pending.tag.sessionId === tag.sessionId && pending.tag.runId === tag.runId
      && pending.tag.windowId === tag.windowId && pending.tag.actionId === tag.actionId
      && pending.tag.generation === tag.generation && this.generation === tag.generation
      && pending.tag.settlementToken === tag.settlementToken;
  }
  acknowledgeActionSettlement(ack: CuaActionSettlementAck): boolean {
    const pending = this.postInput;
    if (!this.matchesSettlement(ack) || !pending || pending.stage !== 'released' || !pending.reported
      || !['committed', 'noop'].includes(ack.outcome) || this.getHeldInputCount() !== 0
      || !this.receipt || (ack.outcome === 'noop' ? ack.contentRevision !== this.receipt.contentRevision : ack.contentRevision <= this.receipt.contentRevision)
      || ack.layoutRevision !== pending.reported.layoutRevision || ack.contentRevision !== pending.reported.contentRevision
      || this.surface?.layoutRevision !== ack.layoutRevision || this.surface.contentRevision !== ack.contentRevision) return false;
    try { this.live(); } catch { return false; }
    if (this.state.phase !== 'acting' || this.executionBlocked || this.surface.executionBlocked || !this.surface.safeSurface?.interactive) return false;
    this.postInput = null;
    this.updateReceipt({ rendererSettlement: 'acknowledged', observationReady: true });
    pending.resolve(true);
    return true;
  }
  /** Main-only diagnostics; no input, capture or authority is granted. */
  getHeldInputCount(): number {
    return Number(this.heldMouse !== null) + Number(this.heldKey !== null);
  }
  getCurrentFrame(scope: CuaFrameScope): CuaFrameMetadata | null {
    return this.currentFrame(scope);
  }
  private currentFrame(scope: CuaFrameScope, owner?: object): CuaFrameMetadata | null {
    try {
      if (this.observationLease && this.observationLease !== owner) return null;
      this.assertObservationScope(scope);
      if (this.getHeldInputCount() !== 0) return null;
      const { pngDataUrl: _png, ...metadata } = this.frame!;
      return structuredClone(metadata);
    } catch { return null; }
  }
  /** Main-only lifetime exclusion. Abort requests transport cancellation;
   * only its owner's release confirms that transport has actually settled. */
  acquireObservationLease(scope: CuaFrameScope, signal?: AbortSignal): CuaObservationLease | null {
    if (signal?.aborted || this.observationLease) return null;
    const immutableScope = structuredClone(scope);
    const frame = this.currentFrame(immutableScope);
    if (!frame) return null;
    let settle!: () => void;
    const owner = { controller: new AbortController(), settled: new Promise<void>(resolve => { settle = resolve; }) };
    const abort = (): void => { owner.controller.abort(); };
    signal?.addEventListener('abort', abort, { once: true });
    this.observationLease = owner;
    return {
      frame, signal: owner.controller.signal,
      getCurrentFrame: () => this.observationLease === owner && !owner.controller.signal.aborted ? this.currentFrame(immutableScope, owner) : null,
      release: () => {
        if (this.observationLease !== owner) return;
        signal?.removeEventListener('abort', abort);
        this.observationLease = null;
        owner.controller.abort();
        settle();
      }
    };
  }
  private markTargetGone(reason: string): void {
    this.publish({ targetGone: true });
    // A later close is a new lifecycle observation, not a replay of an old
    // already-settled Stop snapshot. Failure latches remain intact.
    if (this.state.phase === 'stopped' || this.state.phase === 'cleanup-failed') this.cancellation = null;
    void this.cancel(reason);
  }
  /** Read-only main seam used to bind a separate approved Save capability. */
  assertObservationScope(scope: CuaFrameScope): void {
    this.live();
    const frame = this.frame, surface = this.surface;
    if (this.observing || this.state.phase !== 'ready' || !frame || !surface?.safeSurface || this.cleanupFailureLatched
      || scope.windowId !== this.window.id || scope.sessionId !== frame.sessionId || scope.runId !== frame.runId || scope.frameId !== frame.frameId
      || scope.layoutRevision !== frame.layoutRevision || surface.layoutRevision !== frame.layoutRevision
      || scope.contentRevision !== frame.contentRevision || surface.contentRevision !== frame.contentRevision
      || performance.now() - this.frameTime > 120000 || this.window.webContents.getZoomFactor() !== frame.zoomFactor
      || (this.dependencies.getDeviceScaleFactor?.() ?? 1) !== frame.deviceScaleFactor) throw new Error('CUA_SAVE_SCOPE_CHANGED');
  }
  acknowledgePrepare(ack: CuaPrepareAck): boolean {
    const pending = this.prepareAck;
    if (!ack || !pending || this.state.phase !== 'preparing' || ack.runId !== pending.request.runId || ack.prepareToken !== pending.token) return false;
    this.prepareAck = null; pending.resolve(true); return true;
  }
  invalidateContent(reason = 'content-changed'): void {
    const active = this.frame !== null || this.observing || this.state.phase === 'preparing' || this.state.phase === 'acting';
    this.frame = null;
    if (active) void this.cancel(reason);
  }
  acknowledgeCancel(ack: CuaCancelAck): boolean {
    if (!ack || this.state.phase !== 'stopping' || !this.cancelAck || ack.runId !== this.cancelAck.runId || ack.cancelToken !== this.cancelAck.token) return false;
    const pending = this.cancelAck; this.cancelAck = null; pending.resolve(); return true;
  }
  setExecutionBlocked(blocked: boolean): void {
    this.executionBlocked = blocked;
    if (blocked && (this.state.phase === 'acting' || this.state.phase === 'preparing')) void this.cancel('main-blocked');
  }
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
  private invalidSurface(code = 'CUA_INVALID_SURFACE'): never {
    this.surface = null; this.frame = null;
    if (['ready', 'preparing', 'acting'].includes(this.state.phase)) void this.cancel('invalid-surface');
    throw new Error(code);
  }
  reportSurface(snapshot: CuaSurfaceSnapshot, settlement?: CuaActionSettlementTag): boolean {
    if (!snapshot) this.invalidSurface();
    if (settlement && (!this.matchesSettlement(settlement) || this.postInput?.stage === 'prepared' || !this.postInput?.triggerAttempted)) return false;
    if (settlement && this.postInput?.reported && (snapshot.layoutRevision !== this.postInput.reported.layoutRevision
      || snapshot.contentRevision !== this.postInput.reported.contentRevision)) { void this.cancel('settlement-content-changed'); return false; }
    // Runtime validation is mandatory: the bridge does not make renderer data trusted.
    if (!snapshot || !Number.isSafeInteger(snapshot.layoutRevision) || snapshot.layoutRevision < 0
      || !Number.isSafeInteger(snapshot.contentRevision) || snapshot.contentRevision < 0
      || typeof snapshot.executionBlocked !== 'boolean' || typeof snapshot.focusedInSafeSurface !== 'boolean'
      || !snapshot.viewport || ![snapshot.viewport.width, snapshot.viewport.height].every(n => Number.isFinite(n) && n > 0 && n < 32768)
      || !Array.isArray(snapshot.protectedRects) || snapshot.protectedRects.length > 256) this.invalidSurface();
    const validRect = (r: CuaRect): boolean => !!r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 0 && r.height >= 0;
    const protectedKinds = ['stop-button', 'approval-ui', 'agent-panel', 'settings', 'chrome-menu', 'modal'];
    if ((snapshot.blockReason !== null && (typeof snapshot.blockReason !== 'string' || snapshot.blockReason.length > 256))
      || (snapshot.focusedTestId !== null && (typeof snapshot.focusedTestId !== 'string' || snapshot.focusedTestId.length > 512))
      || snapshot.protectedRects.some(p => !p || typeof p.id !== 'string' || p.id.length > 256 || !protectedKinds.includes(p.kind) || !validRect(p.rect))
      || (snapshot.safeSurface !== null && (!snapshot.safeSurface || !validRect(snapshot.safeSurface.rect)
        || snapshot.safeSurface.rect.width <= 0 || snapshot.safeSurface.rect.height <= 0 || typeof snapshot.safeSurface.interactive !== 'boolean'
        || !['timeline', 'canvas', 'shorts-review'].includes(snapshot.safeSurface.kind)))) this.invalidSurface();
    const rect = (r: CuaRect): CuaRect => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    // Copy only validated contract fields; unknown/cyclic renderer properties
    // must not survive into frame comparisons or fixed DOM verification.
    snapshot = { contentRevision: snapshot.contentRevision, layoutRevision: snapshot.layoutRevision,
      executionBlocked: snapshot.executionBlocked, blockReason: snapshot.blockReason,
      viewport: { width: snapshot.viewport.width, height: snapshot.viewport.height },
      safeSurface: snapshot.safeSurface && { kind: snapshot.safeSurface.kind, rect: rect(snapshot.safeSurface.rect), interactive: snapshot.safeSurface.interactive },
      protectedRects: snapshot.protectedRects.map(p => ({ id: p.id, kind: p.kind, rect: rect(p.rect) })),
      focusedInSafeSurface: snapshot.focusedInSafeSurface, focusedTestId: snapshot.focusedTestId };
    if (this.surface && snapshot.layoutRevision < this.surface.layoutRevision) this.invalidSurface('CUA_STALE_SURFACE');
    if (this.surface && snapshot.contentRevision < this.surface.contentRevision) this.invalidSurface('CUA_STALE_CONTENT');
    const changed = this.surface !== null && (snapshot.layoutRevision !== this.surface.layoutRevision
      || JSON.stringify(snapshot.viewport) !== JSON.stringify(this.surface.viewport)
      || JSON.stringify(snapshot.safeSurface && { kind: snapshot.safeSurface.kind, rect: snapshot.safeSurface.rect }) !== JSON.stringify(this.surface.safeSurface && { kind: this.surface.safeSurface.kind, rect: this.surface.safeSurface.rect })
      || this.protectedGeometry(snapshot) !== this.protectedGeometry(this.surface));
    const contentChanged = this.surface !== null && snapshot.contentRevision !== this.surface.contentRevision;
    this.surface = structuredClone(snapshot);
    if (changed) { this.frame = null; if (['ready', 'preparing', 'acting'].includes(this.state.phase)) void this.cancel('surface-changed'); }
    else if (contentChanged && !settlement) this.invalidateContent();
    else if (this.state.phase === 'acting' && (snapshot.executionBlocked || !snapshot.safeSurface?.interactive)) void this.cancel('surface-blocked');
    if (settlement && this.matchesSettlement(settlement) && this.postInput && !changed) {
      this.postInput.reported = { layoutRevision: snapshot.layoutRevision, contentRevision: snapshot.contentRevision };
      return true;
    }
    return !settlement;
  }
  async observe(context: { sessionId: string; runId: string }): Promise<CuaFrame> {
    this.live();
    if (this.postInput || this.observationLease || this.dependencies.getPendingApproval?.()) throw new Error('CUA_BUSY');
    if (this.observing || this.state.phase === 'acting' || this.state.phase === 'preparing' || this.state.phase === 'stopping' || this.cleanupFailureLatched) throw new Error('CUA_BUSY');
    if (!context.sessionId || !context.runId || !this.surface?.safeSurface) throw new Error('CUA_UNSAFE_SURFACE');
    this.observing = true;
    this.frame = null;
    try {
    const snapshot = structuredClone(this.surface);
    const revision = this.generation;
    const safe = snapshot.safeSurface!;
    const expected = JSON.stringify({ kind: safe.kind, rect: safe.rect, viewport: snapshot.viewport });
    const safeDocument: unknown = await this.window.webContents.executeJavaScript(`(() => {
      const expected = ${expected};
      const visible = e => { const r=e.getBoundingClientRect(),s=getComputedStyle(e); return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden' && !e.closest('[hidden],[aria-hidden="true"]'); };
      if (Math.abs(innerWidth-expected.viewport.width)>0.5 || Math.abs(innerHeight-expected.viewport.height)>0.5) return false;
      if ([...document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open],[role="menu"],[data-cua-protected="settings"]')].some(visible)) return false;
      const e=[...document.querySelectorAll('[data-cua-safe-surface]')].find(e=>e.getAttribute('data-cua-safe-surface')===expected.kind && visible(e));
      if (!e) return false;
      const r=e.getBoundingClientRect(),p=expected.rect;
      return p.x>=r.x-0.5 && p.y>=r.y-0.5 && p.x+p.width<=r.right+0.5 && p.y+p.height<=r.bottom+0.5;
    })()`);
    if (safeDocument !== true) throw new Error('CUA_UNSAFE_DOCUMENT');
    // The await above lets the trusted orchestrator install its active
    // observation promise. A renderer reason alone cannot authorize an inert read.
    if (!safe.interactive) {
      const pending = this.dependencies.getPendingApproval?.();
      const causeMatches = snapshot.blockReason === 'agent-busy' || (snapshot.blockReason === 'pending-approval'
        && pending?.sessionId === context.sessionId && pending.runId === context.runId && pending.windowId === this.window.id);
      if (!snapshot.executionBlocked || !causeMatches || !this.dependencies.isObservationInFlight?.(context)) throw new Error('CUA_UNSAFE_SURFACE');
    }
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
      || snapshot.contentRevision !== this.surface.contentRevision
      || JSON.stringify(snapshot.safeSurface && { kind: snapshot.safeSurface.kind, rect: snapshot.safeSurface.rect }) !== JSON.stringify(this.surface.safeSurface && { kind: this.surface.safeSurface.kind, rect: this.surface.safeSurface.rect })
      || this.protectedGeometry(snapshot) !== this.protectedGeometry(this.surface)
      || JSON.stringify(snapshot.viewport) !== JSON.stringify(this.surface.viewport)) throw new Error('CUA_STALE_FRAME');
    const png = image.toPNG();
    if (image.isEmpty() || png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('CUA_EMPTY_CAPTURE');
    const bitmap = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    if (bitmap.width <= 0 || bitmap.height <= 0) throw new Error('CUA_EMPTY_CAPTURE');
    const frame: CuaFrame = { ...context, contentRevision: snapshot.contentRevision, windowId: this.window.id, frameId: randomUUID(), layoutRevision: snapshot.layoutRevision, capturedAt: Date.now(), viewport: snapshot.viewport, bitmap, deviceScaleFactor: this.dependencies.getDeviceScaleFactor?.() ?? 1, zoomFactor: this.window.webContents.getZoomFactor(), pngDataUrl: `data:image/png;base64,${png.toString('base64')}` };
    this.frame = frame; this.frameTime = performance.now(); this.cancellation = null;
    this.publish({ ...context, targetGone: false, phase: 'ready', error: null, cleanupComplete: true, releaseFailures: [] });
    return frame;
    } finally { this.observing = false; }
  }
  private validate(request: CuaActionRequest, preparing = false, preflight = false): CuaPoint[] {
    this.live();
    if (this.observationLease || this.observing || this.state.phase !== (preparing ? 'preparing' : 'ready')) throw new Error('CUA_BUSY');
    const f = this.frame, s = this.surface;
    if (!f || !s || !Number.isSafeInteger(request.contentRevision) || request.contentRevision !== f.contentRevision || s.contentRevision !== f.contentRevision || request.sessionId !== f.sessionId || request.runId !== f.runId || request.windowId !== this.window.id || request.frameId !== f.frameId || request.layoutRevision !== f.layoutRevision || s.layoutRevision !== f.layoutRevision || performance.now() - this.frameTime > 120000 || this.window.webContents.getZoomFactor() !== f.zoomFactor
      || (this.dependencies.getDeviceScaleFactor?.() ?? 1) !== f.deviceScaleFactor) throw new Error('CUA_STALE_FRAME');
    if (this.executionBlocked || !s.safeSurface || (!preflight && (s.executionBlocked || !s.safeSurface.interactive))) throw new Error('CUA_EXECUTION_BLOCKED');
    const action = request.action;
    if (!action || !['click', 'drag', 'key'].includes(action.kind)) throw new Error('CUA_INVALID_ACTION');
    if (action.kind === 'key') {
      if ((!preflight && !s.focusedInSafeSurface) || !CUA_KEYS.includes(action.key) || !Array.isArray(action.modifiers)
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
    const release = event.type === 'mouseUp' || event.type === 'keyUp';
    if (!release && (this.state.phase !== 'acting' || this.executionBlocked || this.surface?.executionBlocked || !this.surface?.safeSurface?.interactive)) throw new Error('CUA_CANCELLED');
    if (!release) {
      this.live();
      if (!this.frame || this.window.webContents.getZoomFactor() !== this.frame.zoomFactor
        || (this.dependencies.getDeviceScaleFactor?.() ?? 1) !== this.frame.deviceScaleFactor) throw new Error('CUA_STALE_FRAME');
    }
    if (this.postInput?.stage === 'armed' && this.receipt && (
      (this.receipt.actionKind === 'key' && event.type === 'keyDown')
      || (this.receipt.actionKind === 'click' && event.type === 'mouseDown')
      || (this.receipt.actionKind === 'drag' && this.normalRelease && event.type === 'mouseUp')
    )) this.postInput.triggerAttempted = true;
    const planned = !release || this.normalRelease;
    if (this.receipt) this.updateReceipt({
      attemptedEvents: this.receipt.attemptedEvents + Number(planned),
      release: { ...this.receipt.release, heldInputCount: this.getHeldInputCount(), attemptedEvents: this.receipt.release.attemptedEvents + Number(release) }
    }, false);
    this.injecting = true;
    try {
      this.window.webContents.sendInputEvent(event);
      if (this.receipt) this.updateReceipt({ returnedEvents: this.receipt.returnedEvents + Number(planned),
        release: { ...this.receipt.release, returnedEvents: this.receipt.release.returnedEvents + Number(release) } }, false);
    } catch (error) {
      this.updateReceipt({ dispatchUncertain: true }, false);
      throw new Error('CUA_NATIVE_DISPATCH_UNCERTAIN');
    } finally {
      this.injecting = false;
      if (this.receipt && !release) this.publish({ lastDispatchReceipt: structuredClone(this.receipt) });
    }
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
    this.validate(request, false, true);
    if (signal?.aborted) throw new Error('CUA_CANCELLED');
    this.dependencies.checkPermit(request, permit); // No preparation without exact main approval.
    const generation = this.generation;
    const actionId = randomUUID();
    const tag: CuaActionSettlementTag = { sessionId: request.sessionId, runId: request.runId, windowId: request.windowId,
      actionId, generation, settlementToken: randomUUID() };
    const settled = new Promise<boolean>(resolve => { this.postInput = { tag, stage: 'prepared', triggerAttempted: false, reported: null, resolve }; });
    this.receipt = { actionId, actionKind: request.action.kind, sessionId: request.sessionId, runId: request.runId,
      windowId: request.windowId, frameId: request.frameId, layoutRevision: request.layoutRevision, contentRevision: request.contentRevision,
      generation, dispatch: 'no-dispatch', expectedEvents: request.action.kind === 'key' ? 2 : this.validate(request, false, true).length + 2,
      attemptedEvents: 0, returnedEvents: 0, dispatchUncertain: false,
      release: { attemptedEvents: 0, returnedEvents: 0, heldInputCount: 0, failures: [] }, rendererSettlement: 'pending', observationReady: false };
    this.updateReceipt({}, false);
    const arm = (): void => {
      if (!this.postInput || generation !== this.generation) throw new Error('CUA_CANCELLED');
      this.postInput.stage = 'armed';
      this.publish({ postInput: { ...tag, actionKind: request.action.kind, stage: 'armed' } });
      if (generation !== this.generation || this.state.phase !== 'acting' || !this.postInput) throw new Error('CUA_CANCELLED');
    };
    const abort = (): void => { void this.cancel('aborted'); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const prepareToken = randomUUID();
      const acknowledged = new Promise<boolean>(resolve => {
        this.prepareAck = { token: prepareToken, request: structuredClone(request), resolve };
      });
      this.publish({ postInput: { ...tag, actionKind: request.action.kind, stage: 'prepared' }, phase: 'preparing', prepareToken, cleanupComplete: true, label: request.action.kind });
      let timeout!: ReturnType<typeof setTimeout>;
      let prepared: boolean;
      try { prepared = await Promise.race([acknowledged, new Promise<false>(resolve => { timeout = setTimeout(() => resolve(false), 500); })]); }
      finally { clearTimeout(timeout); this.prepareAck = null; }
      if (generation !== this.generation || signal?.aborted) throw new Error('CUA_CANCELLED');
      if (!prepared) throw new Error('CUA_PREPARE_TIMEOUT');
      let points = this.validate(request, true);
      await this.verifyDom(request, points);
      // Renderer acknowledgement and DOM reads are not authority. Recheck all
      // mutable guards, then consume once immediately before the first input.
      if (generation !== this.generation || signal?.aborted) throw new Error('CUA_CANCELLED');
      points = this.validate(request, true);
      this.dependencies.consumePermit(request, permit);
      this.publish({ phase: 'acting', prepareToken: null, cleanupComplete: false });
      if (generation !== this.generation || signal?.aborted) throw new Error('CUA_CANCELLED');
      if (request.action.kind === 'key') {
        arm();
        this.heldKey = { type: 'keyDown', keyCode: ELECTRON_KEY_CODES[request.action.key] ?? request.action.key, modifiers: [...request.action.modifiers] };
        this.input(this.heldKey);
      } else {
        const first = points[0]!;
        this.mouse('mouseMove', first); this.heldMouse = first; this.heldZoom = this.window.webContents.getZoomFactor();
        if (request.action.kind === 'click') arm();
        this.mouse('mouseDown', first);
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
      if (request.action.kind === 'drag') arm();
      this.normalRelease = true;
      let failures: string[];
      try { failures = this.release(); } finally { this.normalRelease = false; }
      if (failures.length) { this.cleanupFailureLatched = true; throw new Error('CUA_RELEASE_FAILED'); }
      if (generation !== this.generation || !this.postInput) throw new Error('CUA_CANCELLED');
      this.frame = null;
      this.postInput.stage = 'released';
      this.publish({ postInput: { ...tag, actionKind: request.action.kind, stage: 'released' }, cleanupComplete: true, dragStart: null });
      let timer!: ReturnType<typeof setTimeout>;
      let accepted: boolean;
      try { accepted = await Promise.race([settled, new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 1000); })]); }
      finally { clearTimeout(timer); }
      if (!accepted || generation !== this.generation) {
        if (this.receipt?.rendererSettlement === 'pending') this.updateReceipt({ rendererSettlement: 'timed-out', observationReady: false });
        await this.cancel('CUA_POST_INPUT_SETTLEMENT_UNCONFIRMED');
        return this.getState();
      }
      this.publish({ postInput: null, phase: 'ready', cleanupComplete: true, releaseFailures: [], error: null });
      return this.getState();
    } catch (error) {
      await this.cancel(error instanceof Error ? error.message : 'error');
      if (this.receipt && this.receipt.attemptedEvents > 0) return this.getState();
      throw error;
    }
    finally { signal?.removeEventListener('abort', abort); }
  }
  private release(): string[] {
    let resolveRelease!: () => void;
    this.physicalRelease = new Promise(resolve => { resolveRelease = resolve; });
    try {
    const failures: string[] = [];
    if (this.heldMouse) { try { this.mouse('mouseUp', this.heldMouse); this.heldMouse = null; this.heldZoom = null; } catch { failures.push('left'); } }
    if (this.heldKey) { const key = this.heldKey; try { this.input({ ...key, type: 'keyUp' }); this.heldKey = null; } catch { failures.push(key.keyCode); } }
    if (this.receipt) {
      const safeFailures: CuaReleaseFailure[] = failures.map(value => value === 'left' ? 'mouse-release-failed' : 'key-release-failed');
      this.updateReceipt({ release: { ...this.receipt.release, heldInputCount: this.getHeldInputCount(),
        failures: [...new Set([...this.receipt.release.failures, ...safeFailures])] } });
    }
    return failures;
    } finally { this.physicalRelease = null; resolveRelease(); }
  }
  cancel(reason = 'stopped'): Promise<CuaState> {
    if (this.cancellation) return this.cancellation;
    const lease = this.observationLease;
    const leaseSettlement = lease?.settled;
    this.generation++; this.frame = null; this.executionBlocked = true;
    const postInput = this.postInput; this.postInput = null; postInput?.resolve(false);
    const pendingPrepare = this.prepareAck; this.prepareAck = null; pendingPrepare?.resolve(false);
    // Assign the promise before callbacks so recursive cancellation is idempotent.
    let settle!: (state: CuaState) => void;
    this.cancellation = new Promise(resolve => { settle = resolve; });
    if (this.receipt) this.updateReceipt({ observationReady: false,
      rendererSettlement: this.receipt.rendererSettlement === 'pending' ? 'cancelled' : this.receipt.rendererSettlement });
    lease?.controller.abort();
    const needsAck = this.heldMouse !== null && this.state.dragStart !== null && this.state.runId !== null;
    let ackReceived = false;
    let resolveAck!: () => void;
    const ackPromise = new Promise<void>(resolve => { resolveAck = resolve; });
    const token = needsAck ? randomUUID() : null;
    if (token && this.state.runId) this.cancelAck = { token, runId: this.state.runId, resolve: () => { ackReceived = true; resolveAck(); } };
    let revokeFailed = false;
    try { this.dependencies.onCancel?.({ sessionId: this.state.sessionId, runId: this.state.runId, reason }); }
    catch { reason += ':authority-revoke-failed'; revokeFailed = true; }
    this.publish({ postInput: null, phase: 'stopping', prepareToken: null, error: reason, cleanupComplete: false, cancelToken: token });
    void (async () => {
      if (needsAck) {
        let timeout!: ReturnType<typeof setTimeout>;
        await Promise.race([ackPromise, new Promise<void>(resolve => { timeout = setTimeout(resolve, 200); })]);
        clearTimeout(timeout);
      }
      this.cancelAck = null;
      if (this.physicalRelease) await this.physicalRelease;
      const hadHeldInput = this.heldMouse !== null || this.heldKey !== null;
      const failures = this.release(); // Always attempt physical release, even without rollback ack.
      if (needsAck && !ackReceived) failures.push('renderer-rollback-unconfirmed');
      if (revokeFailed) failures.push('authority-revoke');
      const targetGone = this.state.targetGone || this.window.isDestroyed() || this.window.webContents.isDestroyed();
      if (targetGone && hadHeldInput) failures.push('target-gone-release-unconfirmed');
      if (failures.length) this.cleanupFailureLatched = true;
      if (this.receipt) {
        const codes: CuaReleaseFailure[] = [];
        if (failures.includes('renderer-rollback-unconfirmed')) codes.push('rollback-unconfirmed');
        if (failures.includes('authority-revoke')) codes.push('authority-revoke-failed');
        if (failures.includes('target-gone-release-unconfirmed')) codes.push('target-gone');
        this.updateReceipt({ release: { ...this.receipt.release, heldInputCount: this.getHeldInputCount(),
          failures: [...new Set([...this.receipt.release.failures, ...codes])] } });
      }
      if (leaseSettlement) await leaseSettlement; // Never claim stopped while transport is live.
      this.publish({ phase: this.cleanupFailureLatched ? 'cleanup-failed' : 'stopped', targetGone, error: reason, cleanupComplete: !this.cleanupFailureLatched, releaseFailures: failures.length ? failures : this.state.releaseFailures, dragStart: null, cancelToken: null });
      settle(this.getState());
    })();
    return this.cancellation;
  }
}
