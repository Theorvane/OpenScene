import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserSessionVault } from '../src/main/browserSessionVault';

const electron = vi.hoisted(() => ({ fromPartition: vi.fn(), windows: vi.fn() }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    session: { fromPartition: electron.fromPartition },
    safeStorage: {},
    BrowserWindow: class extends EventEmitter {
      private destroyed = false;
      webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn(async () => { setTimeout(() => this.destroy(), 0); }),
        getURL: () => 'https://labs.google/'
      });
      constructor() { super(); electron.windows(); }
      isDestroyed() { return this.destroyed; }
      destroy() { this.destroyed = true; this.emit('closed'); }
    }
  };
});
import { BrowserSessionService } from '../src/main/browserSessionService';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const disconnected = (providerId: 'gemini' | 'grok') => ({ providerId, kind: 'disconnected' as const, origin: 'https://labs.google' });
  const vault = {
    clear: vi.fn(async (_providerId: string) => {}),
    getStatus: vi.fn(async (providerId: 'gemini' | 'grok') => disconnected(providerId)),
    loadSecret: vi.fn(async () => null),
    save: vi.fn(async () => ({ ...disconnected('gemini'), kind: 'stored' as const }))
  };
  const partition = Object.assign(new EventEmitter(), {
    clearStorageData: vi.fn(async () => {}),
    cookies: {
      set: vi.fn(async () => {}),
      get: vi.fn(async () => [{ name: 'synthetic', value: 'test-only', domain: '.google.com', hostOnly: false, path: '/', secure: true, httpOnly: true, session: true }])
    },
    webRequest: { onCompleted: vi.fn(), onErrorOccurred: vi.fn() }
  });
  electron.fromPartition.mockReturnValue(partition);
  return { vault, partition, service: new BrowserSessionService(vault as unknown as BrowserSessionVault) };
}
async function assertBusy(service: BrowserSessionService) {
  await expect(service.start('gemini')).resolves.toMatchObject({ kind: 'needs_user_action' });
  await expect(service.clear('gemini')).resolves.toMatchObject({ kind: 'needs_user_action' });
  await expect(service.generateGoogleFlowImage({ modelId: 'unused', prompt: 'test', aspectRatio: '16:9' })).rejects.toThrow(/already/);
  await expect(service.generateGoogleFlowVideo({ modelId: 'unused', prompt: 'test', operation: 'text_to_video', aspectRatio: '16:9', durationSeconds: 5 })).rejects.toThrow(/already/);
  expect((await service.getStatuses()).find((status) => status.providerId === 'gemini')?.kind).toBe('needs_user_action');
}

beforeEach(() => { electron.fromPartition.mockReset(); electron.windows.mockClear(); });
describe('browser session provider operation lifetime', () => {
  it.each(['vault', 'partition'] as const)('holds the guard throughout %s clearing', async (phase) => {
    const { vault, partition, service } = fixture();
    const gate = deferred();
    if (phase === 'vault') vault.clear.mockImplementationOnce(() => gate.promise);
    else partition.clearStorageData.mockImplementationOnce(() => gate.promise);
    const clearing = service.clear('gemini');
    if (phase === 'partition') await vi.waitFor(() => expect(partition.clearStorageData).toHaveBeenCalledOnce());
    await assertBusy(service);
    expect(electron.windows).not.toHaveBeenCalled();
    expect(vault.clear).toHaveBeenCalledTimes(1);
    expect(vault.loadSecret).not.toHaveBeenCalled();
    gate.resolve();
    await expect(clearing).resolves.toMatchObject({ kind: 'disconnected' });
    await expect(service.clear('gemini')).resolves.toMatchObject({ kind: 'disconnected' });
    expect(vault.clear).toHaveBeenCalledTimes(2);
  });

  it.each(['vault', 'partition'] as const)('releases the guard after %s clearing fails', async (phase) => {
    const { vault, partition, service } = fixture();
    const gate = deferred();
    if (phase === 'vault') vault.clear.mockImplementationOnce(() => gate.promise);
    else partition.clearStorageData.mockImplementationOnce(() => gate.promise);
    const failed = expect(service.clear('gemini')).rejects.toThrow('synthetic failure');
    if (phase === 'partition') await vi.waitFor(() => expect(partition.clearStorageData).toHaveBeenCalledOnce());
    expect((await service.getStatuses())[0]?.kind).toBe('needs_user_action');
    gate.reject(new Error('synthetic failure'));
    await failed;
    await expect(service.clear('gemini')).resolves.toMatchObject({ kind: 'disconnected' });
  });

  it('does not block another provider while clearing', async () => {
    const { vault, service } = fixture();
    const gate = deferred();
    vault.clear.mockImplementationOnce(() => gate.promise);
    const clearing = service.clear('gemini');
    await expect(service.clear('grok')).resolves.toMatchObject({ providerId: 'grok', kind: 'disconnected' });
    expect(vault.clear.mock.calls.map(([provider]) => provider)).toEqual(['gemini', 'grok']);
    gate.resolve();
    await clearing;
  });

  it.each(['success', 'failure'] as const)('holds sign-in ownership until vault save %s settles', async (outcome) => {
    const { vault, service } = fixture();
    const gate = deferred();
    vault.save.mockImplementationOnce(async () => { await gate.promise; return { providerId: 'gemini', kind: 'stored', origin: 'https://labs.google' }; });
    const signingIn = service.start('gemini');
    const finished = outcome === 'success'
      ? expect(signingIn).resolves.toMatchObject({ kind: 'stored' })
      : expect(signingIn).rejects.toThrow('synthetic failure');
    await vi.waitFor(() => expect(vault.save).toHaveBeenCalledOnce());
    await assertBusy(service);
    expect(electron.windows).toHaveBeenCalledTimes(1);
    expect(vault.clear).not.toHaveBeenCalled();
    if (outcome === 'success') gate.resolve();
    else gate.reject(new Error('synthetic failure'));
    await finished;
    await expect(service.clear('gemini')).resolves.toMatchObject({ kind: 'disconnected' });
  });
});
