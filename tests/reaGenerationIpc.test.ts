import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { REA_GENERATION_CHANNELS, REA_VIDEO_CREDENTIAL_SLOT } from '../src/shared/reaGenerationApi';
import { registerReaGenerationIpc } from '../src/main/reaGenerationIpc';
import { ReaGenerationService } from '../src/main/reaGenerationService';
import type { ReaGenerationJobStore } from '../src/main/reaGenerationJobStore';

describe('dedicated video credentials and caller authorization', () => {
  it('denies every foreign/subframe caller before touching any service or payload', async () => {
    const frame = {}, contents = { mainFrame: frame, isDestroyed: () => false }, own = { webContents: contents, isDestroyed: () => false };
    const service = { status: vi.fn(), setCredential: vi.fn(), clearCredential: vi.fn(), prepare: vi.fn(), get: vi.fn(), cancel: vi.fn(), getResult: vi.fn(), assemble: vi.fn(), prepareImport: vi.fn(), reference: vi.fn(), submit: vi.fn() };
    const handlers = new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>>();
    registerReaGenerationIpc({ service, getOwnWindow: () => own as unknown as BrowserWindow,
      ipcMain: { handle: (channel: string, fn: (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>) => handlers.set(channel, fn) } as unknown as IpcMain });
    const payload = new Proxy({}, { get: () => { throw new Error('payload touched'); }, ownKeys: () => { throw new Error('payload touched'); } });
    for (const event of [{ sender: {}, senderFrame: frame }, { sender: contents, senderFrame: {} }, { sender: contents }, { sender: contents, senderFrame: null }]) {
      for (const invoke of handlers.values()) expect(await invoke(event as IpcMainInvokeEvent, payload)).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    }
    own.isDestroyed = () => true;
    for (const invoke of handlers.values()) expect(await invoke({ sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent, payload)).toMatchObject({ ok: false });
    for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
    own.isDestroyed = () => false;
    service.status.mockRejectedValueOnce(new Error('fake-key https://signed.example/private-path'));
    const result = await handlers.get(REA_GENERATION_CHANNELS.status)!({ sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent, undefined);
    expect(JSON.stringify(result)).not.toMatch(/fake-key|signed.example|private-path/);
    service.submit.mockRejectedValueOnce(new Error('PAID_EXECUTION_DISABLED'));
    expect(await handlers.get(REA_GENERATION_CHANNELS.submit)!({ sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent, {}))
      .toEqual({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'Paid video execution is disabled.' } });
  });
  it('uses only the fixed slot with fake credentials and keeps key out of status', async () => {
    const credentials = { getCredentialValue: vi.fn(async () => 'fake-video-key'), setCredential: vi.fn(async () => undefined) };
    const jobs = {} as ReaGenerationJobStore;
    const service = new ReaGenerationService(credentials, jobs, async () => true);
    expect(credentials.getCredentialValue).not.toHaveBeenCalled();
    const status = await service.status();
    expect(status).toMatchObject({ credentialConfigured: true, accountAccessVerified: false, paidExecutionAllowed: false, adapterImplemented: false, offlineAdapterImplemented: true });
    expect(JSON.stringify(status)).not.toContain('fake-video-key');
    await service.setCredential({ value: 'fake-new-video-key' }); await service.clearCredential();
    expect(credentials.getCredentialValue).toHaveBeenCalledExactlyOnceWith(REA_VIDEO_CREDENTIAL_SLOT);
    expect(credentials.setCredential.mock.calls).toEqual([[REA_VIDEO_CREDENTIAL_SLOT, 'fake-new-video-key'], [REA_VIDEO_CREDENTIAL_SLOT, '']]);
    for (const payload of [{ provider: 'minimax', value: 'fake-key' }, { value: '\r\n' }, { value: '' }, ['minimax-video-payg', 'fake-key']]) await expect(service.setCredential(payload)).rejects.toThrow();
    expect(credentials.setCredential).toHaveBeenCalledTimes(2);
  });
});
