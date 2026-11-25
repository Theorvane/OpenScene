import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { expect, it, vi } from 'vitest';
import { registerCuaIpc } from '../src/main/cuaIpc';
import type { CuaDriver } from '../src/main/cuaDriver';
import { IPC_CHANNELS } from '../src/shared/ipc';

it('rejects other windows and child frames before consulting driver control', async () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, data?: unknown) => unknown>();
  const ipc = { handle: (name: string, handler: (event: IpcMainInvokeEvent, data?: unknown) => unknown) => handlers.set(name, handler) } as unknown as IpcMain;
  const frame = {}, contents = { mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: contents } as BrowserWindow;
  const driver = { getState: vi.fn(), cancel: vi.fn(async () => undefined), reportSurface: vi.fn(), acknowledgeActionSettlement: vi.fn(), acknowledgePrepare: vi.fn(), acknowledgeCancel: vi.fn() };
  registerCuaIpc(ipc, () => ({ window, driver: driver as unknown as CuaDriver }));
  for (const name of [IPC_CHANNELS.cuaStop, IPC_CHANNELS.cuaGetState, IPC_CHANNELS.cuaReportSurfaceSnapshot, IPC_CHANNELS.cuaAckPrepare, IPC_CHANNELS.cuaAckCancel, IPC_CHANNELS.cuaAckActionSettlement]) {
    const handler = handlers.get(name)!;
    expect(handler({ sender: contents, senderFrame: {} } as IpcMainInvokeEvent)).toMatchObject({ ok: false });
    expect(handler({ sender: {}, senderFrame: frame } as IpcMainInvokeEvent)).toMatchObject({ ok: false });
  }
  expect(driver.cancel).not.toHaveBeenCalled(); expect(driver.reportSurface).not.toHaveBeenCalled();
  expect(driver.acknowledgeActionSettlement).not.toHaveBeenCalled();
  expect(driver.acknowledgePrepare).not.toHaveBeenCalled(); expect(driver.acknowledgeCancel).not.toHaveBeenCalled();
  expect(handlers.get(IPC_CHANNELS.cuaStop)!({ sender: contents, senderFrame: frame } as IpcMainInvokeEvent)).toEqual({ ok: true, value: { accepted: true } });
  expect(driver.cancel).toHaveBeenCalledWith('user-stop');
});
