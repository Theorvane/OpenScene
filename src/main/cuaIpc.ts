import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc';
import type { CuaCancelAck, CuaPrepareAck, CuaSurfaceSnapshot } from '../shared/cua';
import { fail, ok } from './ipcResponses';
import type { CuaDriver } from './cuaDriver';

/** Only the supplied app's own top frame may report safety or request Stop. */
export function registerCuaIpc(ipc: IpcMain, getTarget: () => { window: BrowserWindow; driver: CuaDriver } | null): void {
  const own = (event: IpcMainInvokeEvent): CuaDriver => {
    const target = getTarget();
    if (!target || target.window.isDestroyed() || event.sender !== target.window.webContents
      || event.senderFrame !== target.window.webContents.mainFrame) throw new Error('CUA_UNAUTHORIZED_SENDER');
    return target.driver;
  };
  ipc.handle(IPC_CHANNELS.cuaGetState, event => {
    try { return ok(own(event).getState()); } catch (e) { return fail('UNKNOWN_ERROR', String(e)); }
  });
  ipc.handle(IPC_CHANNELS.cuaAckCancel, (event, ack: CuaCancelAck) => {
    try { return ok({ accepted: own(event).acknowledgeCancel(ack) }); } catch (e) { return fail('UNKNOWN_ERROR', String(e)); }
  });
  ipc.handle(IPC_CHANNELS.cuaAckPrepare, (event, ack: CuaPrepareAck) => {
    try { return ok({ accepted: own(event).acknowledgePrepare(ack) }); } catch (e) { return fail('UNKNOWN_ERROR', String(e)); }
  });
  ipc.handle(IPC_CHANNELS.cuaStop, event => {
    try { void own(event).cancel('user-stop'); return ok({ accepted: true }); } catch (e) { return fail('UNKNOWN_ERROR', String(e)); }
  });
  ipc.handle(IPC_CHANNELS.cuaReportSurfaceSnapshot, (event, snapshot: CuaSurfaceSnapshot) => {
    try { own(event).reportSurface(snapshot); return ok({ accepted: true }); } catch (e) { return fail('UNKNOWN_ERROR', String(e)); }
  });
}
