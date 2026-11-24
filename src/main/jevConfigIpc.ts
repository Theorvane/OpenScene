import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { JEV_CONFIG_CHANNELS, parseJevConfig, type JevJudgmentConfig } from '../shared/jevConfig';
import type { ApiResponse } from '../shared/models';
import type { JevConfigStore } from './jevConfigStore';

export function registerJevConfigIpc({ ipcMain, getOwnWindow, store }: {
  ipcMain: Pick<IpcMain, 'handle'>;
  getOwnWindow: () => BrowserWindow | null;
  store: Pick<JevConfigStore, 'getSnapshot' | 'set'>;
}): void {
  const register = (channel: string, set: boolean) => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<ApiResponse<JevJudgmentConfig>> => {
      try {
        const own = getOwnWindow();
        if (!own || own.isDestroyed() || own.webContents.isDestroyed()
          || event.sender !== own.webContents || !event.senderFrame || event.senderFrame !== own.webContents.mainFrame) {
          return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Jev configuration access denied.' } };
        }
        if (set) {
          const config = args.length === 1 ? parseJevConfig(args[0]) : null;
          if (config) return { ok: true, value: await store.set(config) };
        } else if (args.length === 0) {
          return { ok: true, value: store.getSnapshot() };
        }
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid Jev configuration request.' } };
      } catch {
        return { ok: false, error: { code: 'UNKNOWN_ERROR', message: 'Jev configuration operation failed. Refresh configuration before retrying.' } };
      }
    });
  };
  register(JEV_CONFIG_CHANNELS.get, false);
  register(JEV_CONFIG_CHANNELS.set, true);
}
