import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import type { CredentialStore } from './credentialStore';
import { JEV_API_KEY_MAX_LENGTH, JEV_CREDENTIAL_CHANNELS, type JevCredentialStatus } from '../shared/jevCredentials';
import type { ApiResponse } from '../shared/models';

/** Fixed main-only slot: callers cannot select another provider. */
const JEV_CREDENTIAL_SLOT = 'typesafe-jev';

export function createJevService({ store }: {
  store: Pick<CredentialStore, 'getCredentialValue' | 'setCredential'>;
}) {
  return {
    async getStatus(): Promise<JevCredentialStatus> {
      const key = await store.getCredentialValue(JEV_CREDENTIAL_SLOT);
      return { configured: typeof key === 'string' && key.trim().length > 0 };
    },
    async set(apiKey: string): Promise<JevCredentialStatus> {
      await store.setCredential(JEV_CREDENTIAL_SLOT, apiKey);
      return { configured: true };
    },
    async clear(): Promise<JevCredentialStatus> {
      // CredentialStore's existing clear convention persists an encrypted empty
      // value. Do not bypass its serialized atomic replacement implementation.
      await store.setCredential(JEV_CREDENTIAL_SLOT, '');
      return { configured: false };
    },
    /** Main-only, lazy and fail-closed; never expose this method over IPC. */
    async getApiKey(): Promise<string | null> {
      try {
        const key = await store.getCredentialValue(JEV_CREDENTIAL_SLOT);
        return typeof key === 'string' && key.trim().length > 0 ? key : null;
      } catch {
        return null;
      }
    }
  };
}

export type JevService = ReturnType<typeof createJevService>;

function failure(code: 'PERMISSION_DENIED' | 'INVALID_INPUT' | 'UNKNOWN_ERROR', message: string): ApiResponse<JevCredentialStatus> {
  return { ok: false, error: { code, message } };
}

export function registerJevCredentialIpc({ ipcMain, getOwnWindow, service }: {
  ipcMain: Pick<IpcMain, 'handle'>;
  getOwnWindow: () => BrowserWindow | null;
  service: JevService;
}): void {
  const register = (channel: string, action: (...args: unknown[]) => Promise<ApiResponse<JevCredentialStatus>>) => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<ApiResponse<JevCredentialStatus>> => {
      try {
        const ownWindow = getOwnWindow();
        if (!ownWindow || ownWindow.isDestroyed() || ownWindow.webContents.isDestroyed()
          || event.sender !== ownWindow.webContents || !event.senderFrame
          || event.senderFrame !== ownWindow.webContents.mainFrame) {
          return failure('PERMISSION_DENIED', 'Jev credential access denied.');
        }
        return await action(...args);
      } catch {
        // Storage/Electron exceptions may contain a path or credential. Only
        // this exact public error crosses the bridge, without logging raw data.
        return failure('UNKNOWN_ERROR', 'Jev credential operation failed.');
      }
    });
  };
  const invalid = () => failure('INVALID_INPUT', 'Invalid Jev credential request.');
  register(JEV_CREDENTIAL_CHANNELS.status, async (...args) => args.length === 0
    ? { ok: true, value: await service.getStatus() } : invalid());
  register(JEV_CREDENTIAL_CHANNELS.clear, async (...args) => args.length === 0
    ? { ok: true, value: await service.clear() } : invalid());
  register(JEV_CREDENTIAL_CHANNELS.set, async (...args) => {
    const key = args[0];
    if (args.length !== 1 || typeof key !== 'string' || key.length > JEV_API_KEY_MAX_LENGTH
      || key.trim().length === 0 || /[\u0000-\u001f\u007f]/u.test(key)) return invalid();
    return { ok: true, value: await service.set(key) };
  });
}
