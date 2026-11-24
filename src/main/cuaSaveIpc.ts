import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc';
import type { CuaSaveCommitAck, CuaSaveReadyAck, CuaSaveSnapshotReport } from '../shared/cuaSave';
import type { CuaSaveBridge } from './cuaSaveBridge';
import { fail, ok } from './ipcResponses';
import { normalizeCuaSaveError } from './cuaSaveErrors';

export function registerCuaSaveIpc(ipc: IpcMain, getTarget: () => { window: BrowserWindow; save: CuaSaveBridge } | null): void {
  const own = (event: IpcMainInvokeEvent): CuaSaveBridge => {
    const target = getTarget();
    if (!target || target.window.isDestroyed() || event.sender !== target.window.webContents || event.senderFrame !== target.window.webContents.mainFrame) throw new Error('CUA_UNAUTHORIZED_SENDER');
    return target.save;
  };
  ipc.handle(IPC_CHANNELS.cuaReportSaveSnapshot, (event, report: CuaSaveSnapshotReport) => {
    try { return ok({ accepted: own(event).reportSnapshot(report) }); } catch (e) { return fail('UNKNOWN_ERROR', normalizeCuaSaveError(e)); }
  });
  ipc.handle(IPC_CHANNELS.cuaAckSaveReady, (event, ack: CuaSaveReadyAck) => {
    try { return ok({ accepted: own(event).ackReady(ack) }); } catch (e) { return fail('UNKNOWN_ERROR', normalizeCuaSaveError(e)); }
  });
  ipc.handle(IPC_CHANNELS.cuaAckSaveCommit, (event, ack: CuaSaveCommitAck) => {
    try { return ok({ accepted: own(event).ackCommit(ack) }); } catch (e) { return fail('UNKNOWN_ERROR', normalizeCuaSaveError(e)); }
  });
}
