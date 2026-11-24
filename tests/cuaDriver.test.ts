import { EventEmitter } from 'node:events';
import type { BrowserWindow, MouseInputEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { CuaDriver } from '../src/main/cuaDriver';
import { cuaBitmapPointToViewport, type CuaActionRequest, type CuaSurfaceSnapshot } from '../src/shared/cua';

function fixture() {
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false), isFocused: vi.fn(() => true), getZoomFactor: () => 1,
    capturePage: vi.fn(async () => ({ getSize: () => ({ width: 800, height: 600 }), isEmpty: () => false, toDataURL: () => 'data:image/png;base64,test' })),
    sendInputEvent: vi.fn((input: MouseInputEvent) => contents.emit(input.type.startsWith('mouse') ? 'before-mouse-event' : 'before-input-event', {}, input))
  });
  const window = Object.assign(new EventEmitter(), { id: 7, webContents: contents, isDestroyed: vi.fn(() => false), isFocused: vi.fn(() => true) });
  const consumePermit = vi.fn(); const onCancel = vi.fn();
  const driver = new CuaDriver(window as unknown as BrowserWindow, { consumePermit, onCancel });
  const surface: CuaSurfaceSnapshot = { executionBlocked: false, blockReason: null, layoutRevision: 1, viewport: { width: 800, height: 600 }, safeSurface: { kind: 'timeline', rect: { x: 0, y: 0, width: 800, height: 600 }, interactive: true }, protectedRects: [], focusedInSafeSurface: true, focusedTestId: null };
  driver.reportSurface(surface); driver.setExecutionBlocked(false);
  const observe = async (): Promise<CuaActionRequest> => {
    const frame = await driver.observe({ sessionId: 's', runId: 'r' });
    return { sessionId: 's', runId: 'r', windowId: 7, frameId: frame.frameId, layoutRevision: 1, action: { kind: 'click', point: { x: 20, y: 20 } } };
  };
  return { driver, window, contents, consumePermit, onCancel, surface, observe };
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
    await expect(f.driver.execute(r, 'p')).rejects.toThrow('STALE');
    expect(f.consumePermit).not.toHaveBeenCalled();
  });
  it('releases a held drag on stop and sends no subsequent moves', async () => {
    const f = fixture(), r = await f.observe();
    const execution = f.driver.execute({ ...r, action: { kind: 'drag', from: { x: 20, y: 20 }, to: { x: 200, y: 20 }, durationMs: 3000 } }, 'p');
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
    expect(f.driver.getState().phase).toBe('acting');
    f.contents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' });
    await expect(execution).rejects.toThrow('CANCELLED');
    expect(f.driver.getState().cleanupComplete).toBe(true);
    expect(f.onCancel).toHaveBeenCalledTimes(1);
  });
  it('does not report clean stop if held input release throws', async () => {
    const f = fixture(), r = await f.observe();
    const execution = f.driver.execute({ ...r, action: { kind: 'drag', from: { x: 20, y: 20 }, to: { x: 200, y: 20 }, durationMs: 100 } }, 'p');
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
});
