import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { CuaDriver } from '../src/main/cuaDriver';
import { createJevObservationHook, DEFAULT_JEV_CONFIG, JEV_ENDPOINT, JEV_MODEL } from '../src/main/jevObservationJudgment';

async function fixture() {
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isFocused: () => true, getZoomFactor: () => 1,
    executeJavaScript: async () => true, sendInputEvent: vi.fn(),
    capturePage: async () => ({ isEmpty: () => false, toPNG: () => {
      const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
      png.writeUInt32BE(20, 16); png.writeUInt32BE(20, 20); return png;
    } })
  });
  const window = Object.assign(new EventEmitter(), { id: 7, webContents: contents, isDestroyed: () => false, isFocused: () => true });
  const driver = new CuaDriver(window as unknown as BrowserWindow, { checkPermit: () => undefined, consumePermit: () => undefined });
  driver.reportSurface({ contentRevision: 0, executionBlocked: false, blockReason: null, layoutRevision: 1,
    viewport: { width: 20, height: 20 }, safeSurface: { kind: 'timeline', rect: { x: 0, y: 0, width: 20, height: 20 }, interactive: true },
    protectedRects: [], focusedInSafeSurface: true, focusedTestId: null });
  driver.setExecutionBlocked(false);
  const frame = await driver.observe({ sessionId: 's', runId: 'r' });
  const run = new AbortController();
  const makeHook = (fetch: typeof globalThis.fetch, timeoutMs = 1000) => createJevObservationHook({
    getConfig: () => ({ ...DEFAULT_JEV_CONFIG, enabled: true, timeoutMs }), getApiKey: async () => 'fake-local-only', fetch,
    getObservationContext: () => ({ currentFrame: driver.getCurrentFrame(frame), heldInputCount: driver.getHeldInputCount(),
      cleanupComplete: driver.getState().cleanupComplete, signal: run.signal, kind: 'reobserve', instructions: 'Choose whether evidence needs another explicit observation.',
      candidates: [{ id: 'reobserve', description: 'Insufficient evidence.' }, { id: 'sufficient', description: 'Sufficient evidence.' }] }),
    acquireJudgmentLease: (_conversation, identity) => driver.acquireObservationLease(identity, run.signal)
  });
  return { driver, contents, frame, makeHook, input: { conversationId: 'c', output: { success: true, summary: 'Metadata only.', frame } } };
}
describe('Jev with actual driver lease and local native fetch', () => {
  it('holds input exclusion through native response body completion', async () => {
    const f = await fixture();
    let finish!: () => void;
    let started!: () => void;
    const received = new Promise<void>(resolve => { started = resolve; });
    const server = createServer((request, response) => {
      expect(request.headers.authorization).toBe('Bearer fake-local-only');
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{');
      finish = () => response.end(JSON.stringify({ model: JEV_MODEL, answers: { judgment: { type: 'choice', choice: 'reobserve', confidence: 0.98,
        probabilities: { reobserve: 0.99, sufficient: 0.01 } } }, usage: { input_tokens: 1, output_tokens: 1 } }).slice(1));
      started();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('local server unavailable');
      const hook = f.makeHook(async (url, init) => { expect(url).toBe(JEV_ENDPOINT); return fetch(`http://127.0.0.1:${address.port}`, init); });
      const pending = hook(f.input); await received;
      await expect(f.driver.observe({ sessionId: 's', runId: 'r' })).rejects.toThrow('BUSY');
      await expect(f.driver.execute({ ...f.frame, action: { kind: 'click', point: { x: 2, y: 2 } } }, 'unused')).rejects.toThrow('BUSY');
      expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
      finish(); expect((await pending)?.selectedId).toBe('reobserve');
      expect(f.driver.getCurrentFrame(f.frame)).not.toBeNull();
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('Stop aborts native body reading and waits for transport release', async () => {
    const f = await fixture(); let started!: () => void;
    const received = new Promise<void>(resolve => { started = resolve; });
    const server = createServer((_request, response) => { response.writeHead(200); response.write('{'); started(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('local server unavailable');
      const hook = f.makeHook((_url, init) => fetch(`http://127.0.0.1:${address.port}`, init));
      const pending = hook(f.input); await received;
      const stop = f.driver.cancel('test-stop');
      expect(f.driver.getState().cleanupComplete).toBe(false);
      expect(await pending).toBeNull(); expect((await stop).cleanupComplete).toBe(true);
      expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('keeps Stop pending after bounded fallback until noncooperative transport settles', async () => {
    const f = await fixture(); let settle!: (value: Response) => void;
    const hook = f.makeHook(() => new Promise<Response>(resolve => { settle = resolve; }), 10);
    expect(await hook(f.input)).toBeNull();
    let stopped = false; const stop = f.driver.cancel('test-stop').then(state => { stopped = true; return state; });
    await Promise.resolve(); expect(stopped).toBe(false); expect(f.driver.getState().cleanupComplete).toBe(false);
    settle(new Response('cancelled', { status: 503 }));
    expect((await stop).cleanupComplete).toBe(true); expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
  });
});
