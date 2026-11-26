import type { ReaVideoAnalysisService } from './reaVideoAnalysisService';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { fail, ok } from './ipcResponses';
import { REA_ANALYSIS_CHANNELS } from '../shared/reaVideoAnalysis';
export function registerReaAnalysisIpc({ service, ipcMain, getOwnWindow }: {
  service: Pick<ReaVideoAnalysisService, 'runtime' | 'start' | 'get' | 'cancel' | 'prepareImport'>;
  ipcMain: Pick<IpcMain, 'handle'>;
  getOwnWindow: () => BrowserWindow | null;
}): void {
  for (const action of ['runtime', 'start', 'get', 'cancel', 'prepareImport'] as const) {
    ipcMain.handle(REA_ANALYSIS_CHANNELS[action], async (event: IpcMainInvokeEvent, payload: unknown) => {
      // Authorize before parsing payloads, inspecting runtimes, resolving sources or touching jobs.
      try {
        const own = getOwnWindow();
        if (!own || own.isDestroyed() || own.webContents.isDestroyed() || event.sender !== own.webContents
          || !event.senderFrame || event.senderFrame !== own.webContents.mainFrame) {
          return fail('PERMISSION_DENIED', 'Local analysis access denied.');
        }
      } catch { return fail('PERMISSION_DENIED', 'Local analysis access denied.'); }
      try {
        if (action === 'runtime') return ok(await service.runtime());
        if (action === 'start') return ok(service.start(payload));
        if (action === 'prepareImport') return ok(await service.prepareImport(payload));
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 1 || !('jobId' in payload) || typeof payload.jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(payload.jobId)) return fail('INVALID_INPUT', 'Choose an analysis job.');
        return ok(service[action](payload.jobId));
      } catch { return fail('INVALID_INPUT', 'Analysis request unavailable. Choose an imported video and wait for any running job.'); }
    });
  }
}
