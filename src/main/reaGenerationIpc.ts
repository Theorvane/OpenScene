import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { REA_GENERATION_CHANNELS } from '../shared/reaGenerationApi';
import { fail, ok } from './ipcResponses';
import type { ReaGenerationService } from './reaGenerationService';

export function registerReaGenerationIpc({ service, ipcMain, getOwnWindow }: {
  service: Pick<ReaGenerationService, keyof typeof REA_GENERATION_CHANNELS>;
  ipcMain: Pick<IpcMain, 'handle'>; getOwnWindow: () => BrowserWindow | null;
}) {
  for (const action of Object.keys(REA_GENERATION_CHANNELS) as (keyof typeof REA_GENERATION_CHANNELS)[]) {
    ipcMain.handle(REA_GENERATION_CHANNELS[action], async (event: IpcMainInvokeEvent, payload: unknown) => {
      try {
        const own = getOwnWindow();
        if (!own || own.isDestroyed() || own.webContents.isDestroyed() || event.sender !== own.webContents
          || !event.senderFrame || event.senderFrame !== own.webContents.mainFrame) return fail('PERMISSION_DENIED', 'Generation access denied.');
      } catch { return fail('PERMISSION_DENIED', 'Generation access denied.'); }
      try {
        if (action === 'status' || action === 'clearCredential') {
          if (payload !== undefined) return fail('INVALID_INPUT', 'Generation request rejected.');
          return ok(await service[action]());
        }
        return ok(await service[action](payload));
      } catch { return fail('INVALID_INPUT', 'Generation request rejected. No paid execution was authorized.'); }
    });
  }
}
