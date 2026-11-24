import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createJevService, registerJevCredentialIpc } from '../src/main/jevCredentialService';
import { JEV_API_KEY_MAX_LENGTH, JEV_CREDENTIAL_CHANNELS } from '../src/shared/jevCredentials';

function harness() {
  let value: string | undefined;
  const store = {
    getCredentialValue: vi.fn(async (_slot: string) => value),
    setCredential: vi.fn(async (_slot: string, next: string) => { value = next; })
  };
  const service = createJevService({ store });
  const frame = {};
  const contents = { mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const ipc = { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => { handlers.set(channel, handler); } };
  registerJevCredentialIpc({
    ipcMain: ipc as unknown as Pick<IpcMain, 'handle'>,
    getOwnWindow: () => window as unknown as BrowserWindow,
    service
  });
  const invoke = (channel: keyof typeof JEV_CREDENTIAL_CHANNELS, args: unknown[] = [], event: unknown = { sender: contents, senderFrame: frame }) =>
    handlers.get(JEV_CREDENTIAL_CHANNELS[channel])!(event as IpcMainInvokeEvent, ...args);
  return { store, service, invoke, window, contents, frame };
}

describe('fixed Jev credential boundary', () => {
  it('lazily reads only the fixed slot and clears through the existing empty value convention', async () => {
    const h = harness();
    expect(h.store.getCredentialValue).not.toHaveBeenCalled();
    expect(await h.service.getApiKey()).toBeNull();
    expect(await h.invoke('status')).toEqual({ ok: true, value: { configured: false } });
    expect(await h.invoke('set', ['synthetic-value'])).toEqual({ ok: true, value: { configured: true } });
    expect(typeof await h.service.getApiKey()).toBe('string');
    expect(await h.invoke('clear')).toEqual({ ok: true, value: { configured: false } });
    expect(h.store.setCredential.mock.calls.at(-1)).toEqual(['typesafe-jev', '']);
    expect(await h.service.getApiKey()).toBeNull();
    expect(h.store.getCredentialValue.mock.calls.every(([slot]) => slot === 'typesafe-jev')).toBe(true);
  });

  it('rejects foreign windows, child frames, absent frames and destroyed owners before storage', async () => {
    const h = harness();
    for (const event of [
      { sender: {}, senderFrame: h.frame },
      { sender: h.contents, senderFrame: {} },
      { sender: h.contents, senderFrame: null }
    ]) {
      for (const action of ['status', 'set', 'clear'] as const) {
        expect(await h.invoke(action, action === 'set' ? ['synthetic-value'] : [], event)).toEqual({
          ok: false, error: { code: 'PERMISSION_DENIED', message: 'Jev credential access denied.' }
        });
      }
    }
    h.window.isDestroyed = () => true;
    expect(await h.invoke('status')).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(h.store.getCredentialValue).not.toHaveBeenCalled();
    expect(h.store.setCredential).not.toHaveBeenCalled();
  });

  it('rejects arbitrary slots, malformed inputs, oversized inputs and extra arguments', async () => {
    const h = harness();
    const inputs = [[], [null], [{}], [true], [''], ['   '], ['a\nb'], ['a'.repeat(JEV_API_KEY_MAX_LENGTH + 1)], ['other-slot', 'synthetic-value']];
    for (const args of inputs) expect(await h.invoke('set', args)).toEqual({
      ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid Jev credential request.' }
    });
    expect(await h.invoke('clear', ['other-slot'])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await h.invoke('status', [null])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(h.store.setCredential).not.toHaveBeenCalled();
  });

  it('returns exact sanitized errors and falls back to no key on read failure', async () => {
    const h = harness();
    h.store.getCredentialValue.mockRejectedValue(new Error('synthetic-private-error'));
    h.store.setCredential.mockRejectedValue(new Error('synthetic-private-error'));
    for (const action of ['status', 'set', 'clear'] as const) {
      expect(await h.invoke(action, action === 'set' ? ['synthetic-value'] : [])).toEqual({
        ok: false, error: { code: 'UNKNOWN_ERROR', message: 'Jev credential operation failed.' }
      });
    }
    expect(await h.service.getApiKey()).toBeNull();
  });
});
