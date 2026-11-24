import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import type { BrowserWindow, MouseInputEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { CuaDriver, type CuaDriverDependencies } from '../src/main/cuaDriver';
import { cuaBitmapPointToViewport, type CuaActionRequest, type CuaSurfaceSnapshot } from '../src/shared/cua';

function fixture(autoAck = true, autoPrepare = true) {
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
  let resolveActing!: () => void;
  const acting = new Promise<void>(resolve => { resolveActing = resolve; });
  const driver = new CuaDriver(window as unknown as BrowserWindow, { consumePermit, checkPermit, onCancel, getPendingApproval, onState: state => {
    if (state.phase === 'acting') resolveActing();
    if (autoPrepare && state.phase === 'preparing' && state.prepareToken && state.runId) driver.acknowledgePrepare({ runId: state.runId, prepareToken: state.prepareToken });
    if (autoAck && state.phase === 'stopping' && state.cancelToken && state.runId) driver.acknowledgeCancel({ runId: state.runId, cancelToken: state.cancelToken });
  } });
  const surface: CuaSurfaceSnapshot = { contentRevision: 0, executionBlocked: false, blockReason: null, layoutRevision: 1, viewport: { width: 800, height: 600 }, safeSurface: { kind: 'timeline', rect: { x: 0, y: 0, width: 800, height: 600 }, interactive: true }, protectedRects: [], focusedInSafeSurface: true, focusedTestId: null };
  driver.reportSurface(surface); driver.setExecutionBlocked(false);
  const observe = async (): Promise<CuaActionRequest> => {
    const frame = await driver.observe({ sessionId: 's', runId: 'r' });
    return { contentRevision: 0, sessionId: 's', runId: 'r', windowId: 7, frameId: frame.frameId, layoutRevision: 1, action: { kind: 'click', point: { x: 20, y: 20 } } };
  };
  return { driver, window, contents, consumePermit, checkPermit, onCancel, getPendingApproval, surface, observe, acting };
}
describe('self-window CUA safety', () => {
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
    const rejected = expect(execution).rejects.toThrow('CANCELLED');
    const cancelled = f.driver.cancel('user-stop');
    expect(f.driver.cancel()).toBe(cancelled);
    expect((await cancelled).cleanupComplete).toBe(true);
    const count = f.contents.sendInputEvent.mock.calls.length;
    await rejected;
    expect(f.contents.sendInputEvent).toHaveBeenCalledTimes(count);
    expect(f.contents.sendInputEvent.mock.calls.at(-1)?.[0].type).toBe('mouseUp');
    expect(f.onCancel).toHaveBeenCalledTimes(1);
  });
  it('cancels real input during drag but ignores synchronous injected events', async () => {
    const f = fixture(), r = await f.observe();
    const execution = f.driver.execute({ ...r, action: { kind: 'drag', from: { x: 20, y: 20 }, to: { x: 200, y: 20 }, durationMs: 100 } }, 'p');
    await f.acting;
    expect(f.driver.getState().phase).toBe('acting');
    f.contents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' });
    await expect(execution).rejects.toThrow('CANCELLED');
    expect(f.driver.getState().cleanupComplete).toBe(true);
    expect(f.onCancel).toHaveBeenCalledTimes(1);
  });
  it('does not report clean stop if held input release throws', async () => {
    const f = fixture(), r = await f.observe();
    const execution = f.driver.execute({ ...r, action: { kind: 'drag', from: { x: 20, y: 20 }, to: { x: 200, y: 20 }, durationMs: 100 } }, 'p');
    await f.acting;
    f.contents.sendInputEvent.mockImplementation(() => { throw new Error('closed'); });
    const stopped = await f.driver.cancel('closed');
    expect(stopped.phase).toBe('cleanup-failed');
    expect(stopped.cleanupComplete).toBe(false);
    expect(stopped.releaseFailures).toEqual(['left']);
    await expect(execution).rejects.toThrow('CANCELLED');
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
    const rejected = expect(execution).rejects.toThrow('CANCELLED');
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
    resolve(null); await capture;
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
});
