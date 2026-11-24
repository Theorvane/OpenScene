import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { expect, it, vi } from 'vitest';
import { registerCuaSaveIpc } from '../src/main/cuaSaveIpc';
import type { CuaSaveBridge } from '../src/main/cuaSaveBridge';
import { IPC_CHANNELS } from '../src/shared/ipc';

it('accepts Save reports only from the bound app top frame and exposes no execute or permit endpoint', () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const ipc = { handle: (name: string, handler: (event: IpcMainInvokeEvent, payload?: unknown) => unknown) => { handlers.set(name, handler); } } as unknown as IpcMain;
  const mainFrame = {}, contents = { mainFrame };
  const window = { isDestroyed: () => false, webContents: contents } as BrowserWindow;
  const save = { reportSnapshot: vi.fn(() => true), ackReady: vi.fn(() => true), ackCommit: vi.fn(() => true) };
  registerCuaSaveIpc(ipc, () => ({ window, save: save as unknown as CuaSaveBridge }));
  expect([...handlers.keys()].sort()).toEqual([IPC_CHANNELS.cuaReportSaveSnapshot, IPC_CHANNELS.cuaAckSaveReady, IPC_CHANNELS.cuaAckSaveCommit].sort());
  for (const handler of handlers.values()) {
    expect(handler({ sender: contents, senderFrame: {} } as IpcMainInvokeEvent, {})).toMatchObject({ ok: false });
    expect(handler({ sender: {}, senderFrame: mainFrame } as IpcMainInvokeEvent, {})).toMatchObject({ ok: false });
  }
  expect(save.reportSnapshot).not.toHaveBeenCalled(); expect(save.ackReady).not.toHaveBeenCalled(); expect(save.ackCommit).not.toHaveBeenCalled();
});
