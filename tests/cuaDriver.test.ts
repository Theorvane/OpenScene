import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import type { BrowserWindow, MouseInputEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { CuaDriver, type CuaDriverDependencies } from '../src/main/cuaDriver';
import { cuaBitmapPointToViewport, type CuaActionRequest, type CuaState, type CuaSurfaceSnapshot } from '../src/shared/cua';

function fixture(autoAck = true, autoPrepare = true, autoSettle = true, onStateTap?: (state: CuaState) => void) {
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false), isFocused: vi.fn(() => true), getZoomFactor: vi.fn(() => 1),
    executeJavaScript: vi.fn<(script: string) => Promise<unknown>>(async () => true),
    capturePage: vi.fn(async () => ({ isEmpty: () => false, toPNG: () => {
      const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.writeUInt32BE(800,16); png.writeUInt32BE(600,20); return png;
    } })),
    sendInputEvent: vi.fn((input: MouseInputEvent) => contents.emit(input.type.startsWith('mouse') ? 'before-mouse-event' : 'before-input-event', {}, input))
  });
  const window = Object.assign(new EventEmitter(), { id: 7, webContents: contents, isDestroyed: vi.fn(() => false), isFocused: vi.fn(() => true) });
  const consumePermit = vi.fn(); const checkPermit = vi.fn(); const onCancel = vi.fn();
  const getPendingApproval = vi.fn<NonNullable<CuaDriverDependencies['getPendingApproval']>>(() => null);
  const isObservationInFlight = vi.fn(() => false);
  let resolveActing!: () => void;
  const acting = new Promise<void>(resolve => { resolveActing = resolve; });
  let resolveReleased!: () => void;
  const released = new Promise<void>(resolve => { resolveReleased = resolve; });
  const driver = new CuaDriver(window as unknown as BrowserWindow, { consumePermit, checkPermit, onCancel, getPendingApproval, isObservationInFlight, onState: state => {
    onStateTap?.(state);
    if (state.phase === 'acting') resolveActing();
    if (state.postInput?.stage === 'released') resolveReleased();
    if (autoSettle && state.postInput?.stage === 'released') {
      const tag = state.postInput;
      driver.reportSurface(surface, tag);
      driver.acknowledgeActionSettlement({ ...tag, layoutRevision: surface.layoutRevision, contentRevision: surface.contentRevision, outcome: 'noop' });
    }
    if (autoPrepare && state.phase === 'preparing' && state.prepareToken && state.runId) driver.acknowledgePrepare({ runId: state.runId, prepareToken: state.prepareToken });
    if (autoAck && state.phase === 'stopping' && state.cancelToken && state.runId) driver.acknowledgeCancel({ runId: state.runId, cancelToken: state.cancelToken });
  } });
  const surface: CuaSurfaceSnapshot = { contentRevision: 0, executionBlocked: false, blockReason: null, layoutRevision: 1, viewport: { width: 800, height: 600 }, safeSurface: { kind: 'timeline', rect: { x: 0, y: 0, width: 800, height: 600 }, interactive: true }, protectedRects: [], focusedInSafeSurface: true, focusedTestId: null };
  driver.reportSurface(surface); driver.setExecutionBlocked(false);
  const observe = async (): Promise<CuaActionRequest> => {
    const frame = await driver.observe({ sessionId: 's', runId: 'r' });
    return { contentRevision: 0, sessionId: 's', runId: 'r', windowId: 7, frameId: frame.frameId, layoutRevision: 1, action: { kind: 'click', point: { x: 20, y: 20 } } };
  };
  return { driver, window, contents, consumePermit, checkPermit, onCancel, getPendingApproval, isObservationInFlight, surface, observe, acting, released };
}
describe('self-window CUA safety', () => {
  it('returns cloned current frame metadata without capturing, DOM calls or renewing TTL', async () => {
    const f = fixture(), r = await f.observe();
    const captures = f.contents.capturePage.mock.calls.length, dom = f.contents.executeJavaScript.mock.calls.length;
    const meta = f.driver.getCurrentFrame(r)!;
    expect(meta.frameId).toBe(r.frameId);
    expect(meta).not.toHaveProperty('pngDataUrl');
    (meta.viewport as { width: number }).width = 1;
    expect(f.driver.getCurrentFrame(r)?.viewport.width).toBe(800);
    expect(f.driver.getCurrentFrame({ ...r, runId: 'other' })).toBeNull();
    f.window.isFocused.mockReturnValue(false);
    expect(f.driver.getCurrentFrame(r)).toBeNull();
    f.window.isFocused.mockReturnValue(true);
    const clock = vi.spyOn(performance, 'now');
    const expired = performance.now() + 120001;
    clock.mockReturnValue(expired);
    expect(f.driver.getCurrentFrame(r)).toBeNull();
    expect(f.driver.getCurrentFrame(r)).toBeNull();
    clock.mockRestore();
    expect(f.contents.capturePage).toHaveBeenCalledTimes(captures);
    expect(f.contents.executeJavaScript).toHaveBeenCalledTimes(dom);
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
    expect(f.consumePermit).not.toHaveBeenCalled();
    f.driver.invalidateContent();
    expect(f.driver.getCurrentFrame(r)).toBeNull();
  });
  it('excludes input and capture until the exact lease owner releases, including after abort', async () => {
    const f = fixture(), r = await f.observe(), caller = new AbortController();
    const lease = f.driver.acquireObservationLease(r, caller.signal)!;
    expect(lease).not.toBeNull();
    expect(lease.frame).not.toHaveProperty('pngDataUrl');
    expect(lease.getCurrentFrame()?.frameId).toBe(r.frameId);
    expect(f.driver.getCurrentFrame(r)).toBeNull();
    expect(f.driver.acquireObservationLease(r)).toBeNull();
    await expect(f.observe()).rejects.toThrow('BUSY');
    await expect(f.driver.execute(r, 'p')).rejects.toThrow('BUSY');
    expect(f.checkPermit).not.toHaveBeenCalled();
    caller.abort();
    expect(lease.signal.aborted).toBe(true);
    expect(lease.getCurrentFrame()).toBeNull();
    expect(f.driver.acquireObservationLease(r)).toBeNull();
    lease.release(); lease.release();
    expect(lease.getCurrentFrame()).toBeNull();
    const next = f.driver.acquireObservationLease(r)!;
    lease.release(); // stale release cannot release a subsequent lease.
    expect(f.driver.acquireObservationLease(r)).toBeNull();
    next.release();
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
  it('aborts first and keeps Stop unsettled until transport release, with recursive cancellation safe', async () => {
    const f = fixture(), r = await f.observe(), lease = f.driver.acquireObservationLease(r)!;
    let recursive: Promise<unknown> | undefined;
    lease.signal.addEventListener('abort', () => { recursive = f.driver.cancel('recursive'); });
    const stop = f.driver.cancel('stop');
    expect(recursive).toBe(stop);
    expect(lease.signal.aborted).toBe(true);
    expect(lease.getCurrentFrame()).toBeNull();
    let settled = false;
    void stop.then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    expect(f.driver.getState().phase).toBe('stopping');
    expect(f.driver.acquireObservationLease(r)).toBeNull();
    await expect(f.observe()).rejects.toThrow('BUSY');
    lease.release();
    expect((await stop).cleanupComplete).toBe(true);
    expect(f.driver.getState().phase).toBe('stopped');
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
  it('rejects stale and aborted lease acquisition without changing frame time or authority', async () => {
    const f = fixture(), r = await f.observe(), signal = AbortSignal.abort();
    expect(f.driver.acquireObservationLease(r, signal)).toBeNull();
    expect(f.driver.acquireObservationLease({ ...r, contentRevision: 99 })).toBeNull();
    const lease = f.driver.acquireObservationLease(r)!;
    f.window.isFocused.mockReturnValue(false);
    expect(lease.getCurrentFrame()).toBeNull();
    f.window.isFocused.mockReturnValue(true);
    f.driver.invalidateContent();
    expect(lease.signal.aborted).toBe(true);
    expect(lease.getCurrentFrame()).toBeNull();
    lease.release();
    await f.driver.cancel();
    expect(f.consumePermit).not.toHaveBeenCalled();
  });
  it('blocks capture after release until the exact committed surface and one-use ACK, then captures revision two once', async () => {
    const f = fixture(true, true, false), request = await f.observe();
    const execution = f.driver.execute(request, 'p'); await f.released;
    const tag = f.driver.getState().postInput!;
    expect(f.driver.getHeldInputCount()).toBe(0);
    expect(f.driver.getState().lastDispatchReceipt).toMatchObject({ dispatch: 'full-dispatch', observationReady: false });
    await expect(f.observe()).rejects.toThrow('BUSY');
    expect(f.contents.capturePage).toHaveBeenCalledTimes(1);
    const ack = { ...tag, layoutRevision: 1, contentRevision: 2, outcome: 'committed' as const };
    expect(f.driver.acknowledgeActionSettlement(ack)).toBe(false);
    expect(f.driver.reportSurface({ ...f.surface, contentRevision: 2 }, { ...tag, runId: 'other' })).toBe(false);
    expect(f.driver.reportSurface({ ...f.surface, contentRevision: 2 }, tag)).toBe(true);
    expect(f.driver.acknowledgeActionSettlement({ ...ack, generation: tag.generation + 1 })).toBe(false);
    expect(f.driver.acknowledgeActionSettlement({ ...ack, contentRevision: 1 })).toBe(false);
    expect(f.driver.acknowledgeActionSettlement({ ...ack, outcome: 'noop' })).toBe(false);
    expect(f.driver.acknowledgeActionSettlement(ack)).toBe(true);
    expect(f.driver.acknowledgeActionSettlement(ack)).toBe(false);
    const state = await execution;
    expect(state.lastDispatchReceipt).toMatchObject({ dispatch: 'full-dispatch', returnedEvents: 3, rendererSettlement: 'acknowledged', observationReady: true });
    const before = f.contents.capturePage.mock.calls.length;
    expect((await f.driver.observe({ sessionId: 's', runId: 'r' })).contentRevision).toBe(2);
    expect(f.contents.capturePage).toHaveBeenCalledTimes(before + 1);
    expect(f.consumePermit).toHaveBeenCalledOnce();
  });
  it('rejects pre-input reports and ACKs and preserves a no-dispatch cancellation receipt', async () => {
    const f = fixture(true, false, false), request = await f.observe();
    const execution = f.driver.execute(request, 'p');
    const rejected = expect(execution).rejects.toThrow('CANCELLED');
    const tag = f.driver.getState().postInput!;
    expect(tag.stage).toBe('prepared');
    expect(f.driver.reportSurface(f.surface, tag)).toBe(false);
    expect(f.driver.acknowledgeActionSettlement({ ...tag, layoutRevision: 1, contentRevision: 0, outcome: 'noop' })).toBe(false);
    const cancelled = await f.driver.cancel(); await rejected;
    expect(cancelled.lastDispatchReceipt).toMatchObject({ dispatch: 'no-dispatch', attemptedEvents: 0, rendererSettlement: 'cancelled', observationReady: false });
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
  it('retains full native dispatch on bounded ACK timeout without retrying input or capturing', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(true, true, false), request = await f.observe();
      const execution = f.driver.execute(request, 'p'); await f.released;
      const tag = f.driver.getState().postInput!;
      await vi.advanceTimersByTimeAsync(1001);
      const state = await execution;
      expect(state).toMatchObject({ phase: 'stopped', cleanupComplete: true, lastDispatchReceipt: {
        dispatch: 'full-dispatch', attemptedEvents: 3, returnedEvents: 3, rendererSettlement: 'timed-out', observationReady: false,
        release: { heldInputCount: 0 }
      } });
      expect(f.driver.acknowledgeActionSettlement({ ...tag, layoutRevision: 1, contentRevision: 0, outcome: 'noop' })).toBe(false);
      expect(f.contents.sendInputEvent).toHaveBeenCalledTimes(3);
      expect(f.contents.capturePage).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('fails closed on external content, resize or blur during settlement and rejects late ACKs', async () => {
    for (const event of ['content', 'resize', 'blur']) {
      const f = fixture(true, true, false), request = await f.observe();
      const execution = f.driver.execute(request, 'p'); await f.released;
      const tag = f.driver.getState().postInput!;
      if (event === 'content') f.driver.reportSurface({ ...f.surface, contentRevision: 1 }); else f.window.emit(event);
      const state = await execution;
      expect(state.lastDispatchReceipt).toMatchObject({ dispatch: 'full-dispatch', rendererSettlement: 'cancelled', observationReady: false });
      expect(f.driver.acknowledgeActionSettlement({ ...tag, layoutRevision: 1, contentRevision: 0, outcome: 'noop' })).toBe(false);
      expect(f.contents.capturePage).toHaveBeenCalledTimes(1);
      expect(f.contents.sendInputEvent).toHaveBeenCalledTimes(3);
    }
  });
  it('records thrown native send attempts as uncertain before trusted cancellation, never as zero input', async () => {
    const f = fixture(), request = await f.observe();
    f.contents.sendInputEvent.mockImplementation(() => { throw new Error('/private/native-error'); });
    const beforeAbort: unknown[] = [];
    f.onCancel.mockImplementation(() => {
      beforeAbort.push(f.driver.getState().lastDispatchReceipt);
      void f.driver.cancel('recursive');
    });
    const state = await f.driver.execute(request, 'p');
    expect(state.lastDispatchReceipt).toMatchObject({ dispatch: 'partial-dispatch', attemptedEvents: 1, returnedEvents: 0, dispatchUncertain: true, observationReady: false });
    const receipt = f.driver.getLastDispatchReceipt({ sessionId: 's', runId: 'r' })!;
    expect(JSON.stringify(receipt)).not.toContain('/private');
    expect(f.driver.getLastDispatchReceipt({ sessionId: 's', runId: 'wrong' })).toBeNull();
    expect(f.onCancel).toHaveBeenCalledOnce();
    expect(beforeAbort).toHaveLength(1);
    expect(beforeAbort[0]).toMatchObject({ attemptedEvents: 1, returnedEvents: 0, dispatchUncertain: true });
  });
  it('arms key settlement before keyDown but rejects synchronous pre-dispatch report/ACK', async () => {
    const early: boolean[] = [];
    const f = fixture(true, true, false, state => {
      if (state.postInput?.stage !== 'armed' || early.length > 0) return;
      const tag = state.postInput;
      expect(state.lastDispatchReceipt?.attemptedEvents).toBe(0);
      early.push(f.driver.reportSurface(f.surface, tag));
      early.push(f.driver.acknowledgeActionSettlement({ ...tag, layoutRevision: 1, contentRevision: 0, outcome: 'noop' }));
    });
    const request = await f.observe();
    const execution = f.driver.execute({ ...request, action: { kind: 'key', key: 'ArrowLeft', modifiers: [] } }, 'p');
    await f.released;
    const tag = f.driver.getState().postInput!;
    expect(early).toEqual([false, false]);
    expect(f.driver.reportSurface(f.surface, tag)).toBe(true);
    expect(f.driver.acknowledgeActionSettlement({ ...tag, layoutRevision: 1, contentRevision: 0, outcome: 'noop' })).toBe(true);
    expect((await execution).lastDispatchReceipt).toMatchObject({ dispatch: 'full-dispatch', expectedEvents: 2, rendererSettlement: 'acknowledged', observationReady: true });
  });
  it('accepts only one committed revision per token and preserves an acknowledged receipt on later cancel', async () => {
    const f = fixture(true, true, false), request = await f.observe();
    const execution = f.driver.execute(request, 'p'); await f.released;
    const tag = f.driver.getState().postInput!;
    expect(f.driver.reportSurface({ ...f.surface, contentRevision: 1 }, tag)).toBe(true);
    expect(f.driver.reportSurface({ ...f.surface, contentRevision: 2 }, tag)).toBe(false);
    expect((await execution).lastDispatchReceipt).toMatchObject({ dispatch: 'full-dispatch', rendererSettlement: 'cancelled', observationReady: false });
    const g = fixture(), other = await g.observe();
    const result = await g.driver.execute(other, 'p');
    const cancelled = await g.driver.cancel('late-stop');
    expect(cancelled.lastDispatchReceipt).toMatchObject({ actionId: result.lastDispatchReceipt!.actionId,
      dispatch: 'full-dispatch', rendererSettlement: 'acknowledged', observationReady: false });
  });
  it('does not create a held key when trusted cancellation reenters the arming callback', async () => {
    let cancelled = false;
    const f = fixture(true, true, false, state => {
      if (!cancelled && state.postInput?.stage === 'armed') { cancelled = true; void f.driver.cancel('arming-stop'); }
    });
    const request = await f.observe();
    await expect(f.driver.execute({ ...request, action: { kind: 'key', key: 'ArrowLeft', modifiers: [] } }, 'p')).rejects.toThrow('CANCELLED');
    expect(f.driver.getHeldInputCount()).toBe(0);
    expect(f.driver.getState().lastDispatchReceipt).toMatchObject({ dispatch: 'no-dispatch', attemptedEvents: 0, observationReady: false });
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
  it('waits for an in-stack physical release on recursive native cancellation instead of duplicating it', async () => {
    const f = fixture(), request = await f.observe();
    f.contents.sendInputEvent.mockImplementation(event => {
      if (event.type === 'mouseUp') void f.driver.cancel('native-release-stop');
      return true;
    });
    const state = await f.driver.execute(request, 'p');
    expect(f.contents.sendInputEvent.mock.calls.filter(([event]) => event.type === 'mouseUp')).toHaveLength(1);
    expect(state).toMatchObject({ phase: 'stopped', cleanupComplete: true, lastDispatchReceipt: {
      dispatch: 'full-dispatch', attemptedEvents: 3, returnedEvents: 3, rendererSettlement: 'cancelled', observationReady: false,
      release: { heldInputCount: 0 }
    } });
  });
  it('uses actual bitmap ratio and rejects invalid pixels', () => {
    const f = { bitmap: { width: 1600, height: 1200 }, viewport: { width: 800, height: 600 } };
    expect(cuaBitmapPointToViewport(f, { x: 200, y: 100 })).toEqual({ x: 100, y: 50 });
    expect(() => cuaBitmapPointToViewport(f, { x: 1600, y: 1 })).toThrow('OUT_OF_BOUNDS');
  });
  it('requires current window/frame and performs no input on rejected permit', async () => {
    const f = fixture(), request = await f.observe();
    await expect(f.driver.execute({ ...request, windowId: 99 }, 'p')).rejects.toThrow('STALE');
    f.consumePermit.mockImplementation(() => { throw new Error('denied'); });
    await expect(f.driver.execute(request, 'p')).rejects.toThrow('denied');
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
  it('blocks missing/renderer/main safety and unsafe keyboard shortcuts', async () => {
    const f = fixture(), r = await f.observe();
    f.driver.setExecutionBlocked(true);
    await expect(f.driver.execute(r, 'p')).rejects.toThrow('BLOCKED');
    f.driver.setExecutionBlocked(false);
    await expect(f.driver.execute({ ...r, action: { kind: 'key', key: 'Tab' as never, modifiers: [] } }, 'p')).rejects.toThrow('UNSAFE_KEY');
    f.driver.reportSurface({ ...f.surface, focusedInSafeSurface: false });
    await expect(f.driver.execute({ ...r, action: { kind: 'key', key: 'z', modifiers: ['meta'] } }, 'p')).rejects.toThrow('UNSAFE_KEY');
    expect(f.consumePermit).not.toHaveBeenCalled();
  });
  it('invalidates on geometry and validates protected drag path before consume', async () => {
    const f = fixture();
    f.driver.reportSurface({ ...f.surface, protectedRects: [{ id: 'approval', kind: 'approval-ui', rect: { x: 100, y: 0, width: 40, height: 600 } }] });
    const r = await f.observe();
    await expect(f.driver.execute({ ...r, action: { kind: 'drag', from: { x: 20, y: 20 }, to: { x: 200, y: 20 }, durationMs: 100 } }, 'p')).rejects.toThrow('PROTECTED');
    f.driver.reportSurface({ ...f.surface, layoutRevision: 2 });
    await expect(f.driver.execute(r, 'p')).rejects.toThrow('BUSY');
    expect(f.consumePermit).not.toHaveBeenCalled();
  });
  it('releases a held drag on stop and sends no subsequent moves', async () => {
    const f = fixture(), r = await f.observe();
    const execution = f.driver.execute({ ...r, action: { kind: 'drag', from: { x: 20, y: 20 }, to: { x: 200, y: 20 }, durationMs: 3000 } }, 'p');
    await f.acting;
    const rejected = expect(execution).resolves.toMatchObject({ lastDispatchReceipt: { dispatch: 'partial-dispatch', observationReady: false } });
    const cancelled = f.driver.cancel('user-stop');
    expect(f.driver.cancel()).toBe(cancelled);
    expect((await cancelled).cleanupComplete).toBe(true);
    const count = f.contents.sendInputEvent.mock.calls.length;
    await rejected;
    expect(f.contents.sendInputEvent).toHaveBeenCalledTimes(count);
    expect(f.contents.sendInputEvent.mock.calls.at(-1)?.[0].type).toBe('mouseUp');
    expect(f.onCancel).toHaveBeenCalledTimes(1);
    expect(f.driver.getHeldInputCount()).toBe(0);
  });
  it('cancels real input during drag but ignores synchronous injected events', async () => {
    const f = fixture(), r = await f.observe();
    const execution = f.driver.execute({ ...r, action: { kind: 'drag', from: { x: 20, y: 20 }, to: { x: 200, y: 20 }, durationMs: 100 } }, 'p');
    await f.acting;
    expect(f.driver.getState().phase).toBe('acting');
    f.contents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' });
    await expect(execution).resolves.toMatchObject({ lastDispatchReceipt: { dispatch: 'partial-dispatch', observationReady: false } });
    expect(f.driver.getState().cleanupComplete).toBe(true);
    expect(f.onCancel).toHaveBeenCalledTimes(1);
  });
  it('does not report clean stop if held input release throws', async () => {
    const f = fixture(), r = await f.observe();
    const execution = f.driver.execute({ ...r, action: { kind: 'drag', from: { x: 20, y: 20 }, to: { x: 200, y: 20 }, durationMs: 100 } }, 'p');
    await f.acting;
    expect(f.driver.getHeldInputCount()).toBe(1);
    expect(f.driver.getCurrentFrame(r)).toBeNull();
    f.contents.sendInputEvent.mockImplementation(() => { throw new Error('closed'); });
    const stopped = await f.driver.cancel('closed');
    expect(stopped.phase).toBe('cleanup-failed');
    expect(stopped.cleanupComplete).toBe(false);
    expect(stopped.releaseFailures).toEqual(['left']);
    expect(f.driver.getHeldInputCount()).toBe(1);
    expect(f.driver.getCurrentFrame(r)).toBeNull();
    await expect(execution).resolves.toMatchObject({ lastDispatchReceipt: { dispatch: 'partial-dispatch', observationReady: false } });
    await expect(f.observe()).rejects.toThrow('BUSY');
  });
  it('invalidates frames on resize and refuses unfocused capture', async () => {
    const f = fixture(), r = await f.observe();
    f.window.emit('resize');
    await expect(f.driver.execute(r, 'p')).rejects.toThrow('BUSY');
    f.window.isFocused.mockReturnValue(false);
    await expect(f.observe()).rejects.toThrow('NOT_FOCUSED');
    expect(f.consumePermit).not.toHaveBeenCalled();
  });
  it('times out missing rollback acknowledgement, still releases and locks recovery', async () => {
    const f = fixture(false), r = await f.observe();
    const execution = f.driver.execute({ ...r, action: { kind: 'drag', from: { x: 20, y: 20 }, to: { x: 200, y: 20 }, durationMs: 3000 } }, 'p');
    await f.acting;
    const rejected = expect(execution).resolves.toMatchObject({ lastDispatchReceipt: { dispatch: 'partial-dispatch', observationReady: false } });
    const stop = f.driver.cancel('user-stop');
    const pending = f.driver.getState();
    expect(pending.phase).toBe('stopping');
    expect(f.driver.acknowledgeCancel({ runId: 'wrong', cancelToken: pending.cancelToken! })).toBe(false);
    const stopped = await stop;
    expect(stopped.cleanupComplete).toBe(false);
    expect(stopped.releaseFailures).toContain('renderer-rollback-unconfirmed');
    expect(f.contents.sendInputEvent.mock.calls.at(-1)?.[0].type).toBe('mouseUp');
    expect(f.driver.acknowledgeCancel({ runId: 'r', cancelToken: pending.cancelToken! })).toBe(false);
    await rejected;
    await expect(f.observe()).rejects.toThrow('BUSY');
  });
  it('rejects independently unsafe DOM without consuming a permit', async () => {
    const f = fixture(), r = await f.observe();
    f.contents.executeJavaScript.mockResolvedValue(false);
    await expect(f.driver.execute(r, 'p')).rejects.toThrow('UNSAFE_DOCUMENT');
    expect(f.consumePermit).not.toHaveBeenCalled();
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
  it('converts CSS points to Electron DIP input with zoom, independently of bitmap scale', async () => {
    const f = fixture(); f.contents.getZoomFactor.mockReturnValue(2);
    const r = await f.observe();
    await f.driver.execute(r, 'p');
    expect(f.contents.sendInputEvent.mock.calls[0]?.[0]).toMatchObject({ type: 'mouseMove', x: 40, y: 40 });
  });
  it('allows only current-ledger pending panel pointer as a cancellation exception', async () => {
    const f = fixture(), panel = { x: 600, y: 0, width: 200, height: 600 };
    f.contents.executeJavaScript.mockImplementation(async script => script.includes('const panels') ? panel : true);
    const surface: CuaSurfaceSnapshot = { ...f.surface, safeSurface: { kind: 'timeline', rect: { x: 0, y: 0, width: 500, height: 600 }, interactive: true }, protectedRects: [{ id: 'panel', kind: 'agent-panel', rect: panel }] };
    f.driver.reportSurface(surface);
    const request = await f.observe(); f.driver.setExecutionBlocked(true);
    f.getPendingApproval.mockReturnValue(request);
    f.driver.reportSurface({ ...surface, executionBlocked: true, protectedRects: [...surface.protectedRects, { id: 'approval', kind: 'approval-ui', rect: { x: 610, y: 20, width: 180, height: 100 } }] });
    f.contents.emit('before-mouse-event', {}, { type: 'mouseDown', x: 650, y: 40 });
    expect(f.driver.getState().phase).toBe('ready');
    expect(f.onCancel).not.toHaveBeenCalled();
    await expect(f.driver.execute(request, 'forged')).rejects.toThrow('BLOCKED');
    expect(f.consumePermit).not.toHaveBeenCalled();
    f.getPendingApproval.mockReturnValue({ ...request, runId: 'another-run' });
    f.contents.emit('before-mouse-event', {}, { type: 'mouseDown', x: 650, y: 40 });
    expect(f.onCancel).toHaveBeenCalledOnce();
  });
  it('rejects a fresh-looking snapshot when the document rejects its safety claims', async () => {
    const f = fixture(), r = await f.observe();
    f.contents.executeJavaScript.mockResolvedValue({ safe: true });
    await expect(f.driver.execute(r, 'p')).rejects.toThrow('UNSAFE_DOCUMENT');
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
  it('serializes capture and prevents an older frame being used during recapture', async () => {
    const f = fixture(), r = await f.observe();
    let resolve!: (value: unknown) => void;
    f.contents.executeJavaScript.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const capture = f.observe();
    await expect(f.observe()).rejects.toThrow('BUSY');
    await expect(f.driver.execute(r, 'p')).rejects.toThrow('BUSY');
    resolve(true); await capture;
    await expect(f.driver.execute(r, 'p')).rejects.toThrow('STALE');
    expect(f.consumePermit).not.toHaveBeenCalled();
  });
  it('expires a frame by monotonic absolute age without resetting or rebinding it', async () => {
    const f = fixture(), r = await f.observe();
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 120001);
    await expect(f.driver.execute(r, 'p')).rejects.toThrow('STALE_FRAME');
    expect(f.consumePermit).not.toHaveBeenCalled();
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
  it('fails closed on malformed safety reports and revokes the ready run immediately', async () => {
    const f = fixture(), r = await f.observe();
    expect(() => f.driver.reportSurface({ ...f.surface, viewport: { width: NaN, height: 600 } })).toThrow('INVALID_SURFACE');
    expect(f.onCancel).toHaveBeenCalledOnce();
    await expect(f.driver.execute(r, 'p')).rejects.toThrow('BUSY');
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
  it('does not prepare without a valid non-consuming main permit check', async () => {
    const f = fixture(), r = await f.observe();
    f.checkPermit.mockImplementation(() => { throw new Error('CUA_APPROVAL_MISMATCH'); });
    await expect(f.driver.execute(r, 'forged')).rejects.toThrow('APPROVAL_MISMATCH');
    expect(f.driver.getState().prepareToken).toBeNull();
    expect(f.driver.getState().phase).toBe('ready');
    expect(f.consumePermit).not.toHaveBeenCalled();
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
  it('prepares input-free until current renderer state is reported and a one-use ack arrives', async () => {
    const f = fixture(true, false), r = await f.observe();
    f.driver.reportSurface({ ...f.surface, executionBlocked: true, safeSurface: { ...f.surface.safeSurface!, interactive: false } });
    const execution = f.driver.execute(r, 'approved');
    const token = f.driver.getState().prepareToken!;
    expect(f.driver.getState().phase).toBe('preparing');
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
    expect(f.consumePermit).not.toHaveBeenCalled();
    expect(f.driver.acknowledgePrepare({ runId: 'other', prepareToken: token })).toBe(false);
    f.driver.reportSurface(f.surface);
    expect(f.driver.acknowledgePrepare({ runId: 'r', prepareToken: token })).toBe(true);
    expect(f.driver.acknowledgePrepare({ runId: 'r', prepareToken: token })).toBe(false);
    expect((await execution).cleanupComplete).toBe(true);
    expect(f.checkPermit).toHaveBeenCalledOnce();
    expect(f.consumePermit).toHaveBeenCalledOnce();
  });
  it('times out input-free preparation without consuming or resetting the permit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const f = fixture(true, false), r = await f.observe();
      const execution = f.driver.execute(r, 'approved');
      const rejected = expect(execution).rejects.toThrow('PREPARE_TIMEOUT');
      await vi.advanceTimersByTimeAsync(500); await rejected;
      expect(f.consumePermit).not.toHaveBeenCalled();
      expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
      expect(f.onCancel).toHaveBeenCalledOnce();
      expect(f.driver.getState()).toMatchObject({ phase: 'stopped', prepareToken: null, cleanupComplete: true });
    } finally { vi.useRealTimers(); }
  });
  it('rejects changed content during preparation and clears stale acknowledgements', async () => {
    const f = fixture(true, false), r = await f.observe();
    const execution = f.driver.execute(r, 'approved');
    const rejected = expect(execution).rejects.toThrow('CANCELLED');
    const token = f.driver.getState().prepareToken!;
    f.driver.reportSurface({ ...f.surface, contentRevision: 1 });
    await rejected;
    expect(f.driver.acknowledgePrepare({ runId: 'r', prepareToken: token })).toBe(false);
    expect(f.consumePermit).not.toHaveBeenCalled();
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
  it('accepts a released action commit without rewriting its success, but invalidates a new observed frame', async () => {
    const f = fixture(), r = await f.observe();
    const result = await f.driver.execute(r, 'approved');
    f.driver.reportSurface({ ...f.surface, contentRevision: 1 });
    expect(result.cleanupComplete).toBe(true);
    expect(f.driver.getState().phase).toBe('ready');
    expect(f.onCancel).not.toHaveBeenCalled();
    expect((await f.driver.observe({ sessionId: 's', runId: 'r' })).contentRevision).toBe(1);
    f.driver.reportSurface({ ...f.surface, contentRevision: 2 });
    expect(f.onCancel).toHaveBeenCalledOnce();
    expect(f.driver.getState().phase).toBe('stopped');
  });
  it('allows a fixed-DOM-verified inert readonly observation only with a matching main busy cause', async () => {
    const f = fixture();
    f.driver.reportSurface({ ...f.surface, executionBlocked: true, blockReason: 'agent-busy', safeSurface: { ...f.surface.safeSurface!, interactive: false } });
    await expect(f.observe()).rejects.toThrow('UNSAFE_SURFACE');
    f.isObservationInFlight.mockReturnValue(true);
    expect((await f.driver.observe({ sessionId: 's', runId: 'r' })).contentRevision).toBe(0);
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
    f.driver.reportSurface({ ...f.surface, executionBlocked: true, blockReason: 'blocking-overlay', safeSurface: { ...f.surface.safeSurface!, interactive: false } });
    await expect(f.observe()).rejects.toThrow('UNSAFE_SURFACE');
  });
  it('reports a later close distinctly and cannot clear a failed release by closing or restarting observation', async () => {
    const f = fixture(), request = await f.observe();
    const execution = f.driver.execute({ ...request, action: { kind: 'drag', from: { x: 20, y: 20 }, to: { x: 200, y: 20 }, durationMs: 100 } }, 'p');
    const rejected = expect(execution).resolves.toMatchObject({ lastDispatchReceipt: { dispatch: 'partial-dispatch', observationReady: false } });
    await f.acting;
    f.window.isDestroyed.mockReturnValue(true);
    f.window.emit('closed');
    const state = await f.driver.cancel('closed');
    expect(state).toMatchObject({ targetGone: true, phase: 'cleanup-failed', cleanupComplete: false });
    expect(state.releaseFailures).toContain('target-gone-release-unconfirmed');
    await rejected;
    f.window.isDestroyed.mockReturnValue(false);
    await expect(f.observe()).rejects.toThrow('BUSY');
  });
  it('maps logical DOM arrow keys to the Electron codes that actually deliver those keys', async () => {
    const f = fixture(), request = await f.observe();
    await f.driver.execute({ ...request, action: { kind: 'key', key: 'ArrowLeft', modifiers: [] } }, 'p');
    expect(f.contents.sendInputEvent.mock.calls.map(call => call[0])).toMatchObject([
      { type: 'keyDown', keyCode: 'Left' }, { type: 'keyUp', keyCode: 'Left' }
    ]);
  });
  it('does not retain an old trusted live surface when an unmounted source reports a stale revision', async () => {
    const f = fixture();
    f.driver.reportSurface({ ...f.surface, contentRevision: 1 });
    const frame = await f.driver.observe({ sessionId: 's', runId: 'r' });
    const scope = { projectId: 'p', sessionId: frame.sessionId, runId: frame.runId, windowId: frame.windowId,
      frameId: frame.frameId, layoutRevision: frame.layoutRevision, contentRevision: frame.contentRevision };
    expect(() => f.driver.assertObservationScope(scope)).not.toThrow();
    expect(() => f.driver.reportSurface({ ...f.surface, safeSurface: null })).toThrow('STALE_CONTENT');
    expect(() => f.driver.assertObservationScope(scope)).toThrow('SAVE_SCOPE_CHANGED');
    expect(f.consumePermit).not.toHaveBeenCalled();
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
  it('copies validated surface fields rather than retaining cyclic untrusted renderer extras', async () => {
    const f = fixture();
    const rect: { x: number; y: number; width: number; height: number; extra?: unknown } = { ...f.surface.safeSurface!.rect };
    rect.extra = rect;
    expect(() => f.driver.reportSurface({ ...f.surface, safeSurface: { ...f.surface.safeSurface!, rect } })).not.toThrow();
    expect((await f.driver.observe({ sessionId: 's', runId: 'r' })).contentRevision).toBe(0);
    expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
});
