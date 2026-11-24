import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerJevConfigIpc } from '../src/main/jevConfigIpc';
import { DEFAULT_JEV_CONFIG, JEV_CONFIG_CHANNELS } from '../src/shared/jevConfig';

function harness() {
  const frame = {};
  const contents = { mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  const store = { reload: vi.fn(async () => DEFAULT_JEV_CONFIG), set: vi.fn(async () => DEFAULT_JEV_CONFIG) };
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  registerJevConfigIpc({
    ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => { handlers.set(channel, handler); } } as unknown as Pick<IpcMain, 'handle'>,
    getOwnWindow: () => window as unknown as BrowserWindow, store
  });
  const invoke = (method: 'get' | 'set', args: unknown[] = [], event: unknown = { sender: contents, senderFrame: frame }) =>
    handlers.get(JEV_CONFIG_CHANNELS[method])!(event as IpcMainInvokeEvent, ...args);
  return { invoke, contents, frame, window, store };
}

describe('Jev config IPC', () => {
  it('gets current snapshot and awaits a validated complete set', async () => {
    const h = harness();
    expect(await h.invoke('get')).toEqual({ ok: true, value: DEFAULT_JEV_CONFIG });
    expect(await h.invoke('set', [DEFAULT_JEV_CONFIG])).toEqual({ ok: true, value: DEFAULT_JEV_CONFIG });
    expect(h.store.set).toHaveBeenCalledExactlyOnceWith(DEFAULT_JEV_CONFIG);
  });
  it('rejects foreign frames/windows and destroyed owners before store access', async () => {
    const h = harness();
    for (const event of [{ sender: {}, senderFrame: h.frame }, { sender: h.contents, senderFrame: {} }, { sender: h.contents }]) {
      for (const method of ['get', 'set'] as const) expect(await h.invoke(method, [DEFAULT_JEV_CONFIG], event)).toEqual({
        ok: false, error: { code: 'PERMISSION_DENIED', message: 'Jev configuration access denied.' }
      });
    }
    h.window.isDestroyed = () => true;
    expect(await h.invoke('get')).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(h.store.reload).not.toHaveBeenCalled();
    expect(h.store.set).not.toHaveBeenCalled();
  });
  it('rejects partial/extra/invalid/unknown fields and extra arguments', async () => {
    const h = harness();
    for (const args of [[], [null], [{}], [{ ...DEFAULT_JEV_CONFIG, apiKey: 'synthetic' }],
      [{ ...DEFAULT_JEV_CONFIG, timeoutMs: 0 }], [DEFAULT_JEV_CONFIG, null]]) {
      expect(await h.invoke('set', args)).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid Jev configuration request.' } });
    }
    expect(await h.invoke('get', [null])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(h.store.set).not.toHaveBeenCalled();
  });
  it('never reports success or raw errors after a failed write', async () => {
    const h = harness();
    h.store.set.mockRejectedValueOnce(new Error('synthetic-private-path'));
    expect(await h.invoke('set', [DEFAULT_JEV_CONFIG])).toEqual({
      ok: false, error: { code: 'UNKNOWN_ERROR', message: 'Jev configuration operation failed. Refresh configuration before retrying.' }
    });
  });
  it('requires successful authoritative disk refresh before get can succeed', async () => {
    const h = harness();
    h.store.reload.mockRejectedValueOnce(new Error('synthetic-private-path'));
    expect(await h.invoke('get')).toEqual({
      ok: false, error: { code: 'UNKNOWN_ERROR', message: 'Jev configuration operation failed. Refresh configuration before retrying.' }
    });
    expect(await h.invoke('get')).toEqual({ ok: true, value: DEFAULT_JEV_CONFIG });
  });
});
