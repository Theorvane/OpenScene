import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { JevConfigStore } from '../src/main/jevConfigStore';
import { createJevRuntime } from '../src/main/jevRuntime';
import { createServer } from 'node:http';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { CuaDriver } from '../src/main/cuaDriver';
import { createJevObservationHook, DEFAULT_JEV_CONFIG, JEV_ENDPOINT, JEV_MODEL } from '../src/main/jevObservationJudgment';

import { createMainJevObservationHook } from '../src/main/jevMainObservation';
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
  const { pngDataUrl: _png, ...metadata } = frame;
  const getObservationBinding = vi.fn((id: string) => id === 'c' ? { frame: metadata, signal: run.signal } : null);
  const getApiKey = vi.fn(async () => 'fake-local-only');
  const makeHook = (fetch: typeof globalThis.fetch, enabled = true) => createMainJevObservationHook({
    runtime: { getConfig: () => ({ ...DEFAULT_JEV_CONFIG, enabled }), getApiKey },
    agent: { getObservationBinding }, getDriver: () => driver, fetch
  });
  return { driver, contents, frame, run, getObservationBinding, getApiKey, makeHook,
    input: { conversationId: 'c', output: { success: true, summary: 'Metadata only.', frame } } };
}
describe('trusted main Jev composition', () => {
  it('uses persisted opt-in to reach the real observation adapter and disables it again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jev-persisted-wire-'));
    try {
      const f = await fixture();
      const store = new JevConfigStore(directory); await store.load();
      const network = vi.fn<typeof fetch>(async () => Response.json({ model: JEV_MODEL,
        answers: { judgment: { type: 'choice', choice: 'reobserve', confidence: 0.98,
          probabilities: { reobserve: 0.99, sufficient: 0.01 } } }, usage: { input_tokens: 1, output_tokens: 1 } }));
      const hook = createMainJevObservationHook({
        runtime: createJevRuntime({ service: { getApiKey: f.getApiKey }, readConfig: store.getSnapshot }),
        agent: { getObservationBinding: f.getObservationBinding }, getDriver: () => f.driver, fetch: network
      });
      expect(await hook(f.input)).toBeNull(); expect(network).not.toHaveBeenCalled(); expect(f.getApiKey).not.toHaveBeenCalled();
      await store.set({ ...DEFAULT_JEV_CONFIG, enabled: true });
      expect((await hook({ ...f.input, output: JSON.stringify(f.input.output) }))?.selectedId).toBe('reobserve');
      expect(network).toHaveBeenCalledTimes(1); expect(f.getApiKey).toHaveBeenCalledTimes(1);
      const request = JSON.parse(network.mock.calls[0]![1]!.body as string);
      expect(request).not.toHaveProperty('assets');
      expect(request.questions.judgment.criteria).toHaveProperty('reobserve');
      await store.set(DEFAULT_JEV_CONFIG);
      expect(await hook(f.input)).toBeNull(); expect(network).toHaveBeenCalledTimes(1);
      expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('reads committed persistent config through the actual main runtime closure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jev-main-config-'));
    try {
      const store = new JevConfigStore(directory);
      await store.load();
      const runtime = createJevRuntime({ service: { getApiKey: async () => null }, readConfig: store.getSnapshot });
      expect(runtime.getConfig().enabled).toBe(false);
      await store.set({ ...DEFAULT_JEV_CONFIG, enabled: true });
      expect(runtime.getConfig().enabled).toBe(true);
      const reopened = new JevConfigStore(directory); await reopened.load();
      expect(reopened.getSnapshot().enabled).toBe(true);
      await store.set(DEFAULT_JEV_CONFIG);
      expect(runtime.getConfig().enabled).toBe(false);
      const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
      expect(source).toContain('runtime: createJevRuntime({ service: jevService, readConfig: jevConfigStore.getSnapshot })');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('default-off reads no key and sends no network request', async () => {
    const f = await fixture(), network = vi.fn<typeof fetch>();
    expect(await f.makeHook(network, false)(f.input)).toBeNull();
    expect(network).not.toHaveBeenCalled(); expect(f.getApiKey).not.toHaveBeenCalled();
  });
  it('rejects wrong conversation, stale frame and changed capturedAt before network', async () => {
    const f = await fixture(), network = vi.fn<typeof fetch>();
    expect(await f.makeHook(network)({ ...f.input, conversationId: 'wrong' })).toBeNull();
    expect(await f.makeHook(network)({ ...f.input, output: { ...f.input.output, frame: { ...f.frame, capturedAt: f.frame.capturedAt + 1 } } })).toBeNull();
    f.driver.invalidateContent();
    expect(await f.makeHook(network)(f.input)).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });
  it('keeps metadata context valid during its lease and holds native body input exclusion', async () => {
    const f = await fixture(); let finish!: () => void, started!: () => void;
    const received = new Promise<void>(resolve => { started = resolve; });
    const server = createServer((request, response) => {
      expect(request.headers.authorization).toBe('Bearer fake-local-only');
      expect(request.headers['typesafe-danger-zone-images']).toBeUndefined();
      let body = ''; request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        expect(body).not.toContain('data_base64'); expect(body).not.toContain('assets');
        response.writeHead(200); response.write('{');
        finish = () => response.end(JSON.stringify({ model: JEV_MODEL, answers: { judgment: { type: 'choice', choice: 'reobserve', confidence: 0.99,
          probabilities: { reobserve: 0.99, sufficient: 0.01 } } }, usage: { input_tokens: 1, output_tokens: 1 } }).slice(1));
        started();
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('no loopback');
      const hook = f.makeHook((url, init) => { expect(url).toBe(JEV_ENDPOINT); return fetch(`http://127.0.0.1:${address.port}`, init); });
      const pending = hook(f.input); await received;
      expect(f.driver.getCurrentFrame(f.frame)).toBeNull();
      await expect(f.driver.execute({ ...f.frame, action: { kind: 'click', point: { x: 2, y: 2 } } }, 'unused')).rejects.toThrow('BUSY');
      await expect(f.driver.observe({ sessionId: 's', runId: 'r' })).rejects.toThrow('BUSY');
      finish(); expect((await pending)?.selectedId).toBe('reobserve');
      expect(f.driver.getCurrentFrame(f.frame)).not.toBeNull();
      expect(f.contents.sendInputEvent).not.toHaveBeenCalled();
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
