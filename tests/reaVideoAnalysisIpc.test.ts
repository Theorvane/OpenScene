import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { registerReaAnalysisIpc } from '../src/main/reaVideoAnalysisIpc';
import { REA_ANALYSIS_CHANNELS } from '../src/shared/reaVideoAnalysis';

function harness() {
  const frame = {}, contents = { mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  let own: typeof window | null = window;
  const job = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', projectId: 'project', assetId: 'source', status: 'cancelled' as const, cleanupComplete: true };
  const service = { runtime: vi.fn(async () => ({ available: true, upstreamPython: 'not-used-requires-python-3.10-and-separate-dependency-review' as const })),
    start: vi.fn(() => job), get: vi.fn(() => job), cancel: vi.fn(() => job), prepareImport: vi.fn(async () => []) };
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  registerReaAnalysisIpc({ service, getOwnWindow: () => own as unknown as BrowserWindow | null,
    ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(channel, handler) } as unknown as Pick<IpcMain, 'handle'> });
  const invoke = (action: keyof typeof REA_ANALYSIS_CHANNELS, event: unknown = { sender: contents, senderFrame: frame }, payload: unknown = { jobId: job.id }) =>
    handlers.get(REA_ANALYSIS_CHANNELS[action])!(event as IpcMainInvokeEvent, payload);
  return { service, invoke, frame, contents, window, setOwn: (value: typeof window | null) => { own = value; } };
}
describe('local analysis IPC caller boundary', () => {
  it('authorizes only the live owning top frame on every registered channel before reading payload or calling service', async () => {
    const h = harness();
    const payload = new Proxy({}, { ownKeys: () => { throw new Error('payload must not be inspected'); }, get: () => { throw new Error('payload must not be read'); } });
    const denied = async (event: unknown) => {
      for (const action of Object.keys(REA_ANALYSIS_CHANNELS) as (keyof typeof REA_ANALYSIS_CHANNELS)[]) {
        expect(await h.invoke(action, event, payload)).toEqual({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'Local analysis access denied.' } });
      }
    };
    await denied({ sender: {}, senderFrame: h.frame });
    await denied({ sender: h.contents, senderFrame: {} });
    await denied({ sender: h.contents });
    await denied({ sender: h.contents, senderFrame: null });
    h.window.isDestroyed = () => true; await denied({ sender: h.contents, senderFrame: h.frame });
    h.window.isDestroyed = () => false; h.contents.isDestroyed = () => true; await denied({ sender: h.contents, senderFrame: h.frame });
    h.contents.isDestroyed = () => false; h.setOwn(null); await denied({ sender: h.contents, senderFrame: h.frame });
    h.setOwn({ webContents: { mainFrame: {}, isDestroyed: () => false }, isDestroyed: () => false });
    await denied({ sender: h.contents, senderFrame: h.frame });
    for (const method of Object.values(h.service)) expect(method).not.toHaveBeenCalled();
  });
  it('allows the owning top frame and sanitizes service exceptions', async () => {
    const h = harness();
    for (const action of Object.keys(REA_ANALYSIS_CHANNELS) as (keyof typeof REA_ANALYSIS_CHANNELS)[]) expect(await h.invoke(action)).toMatchObject({ ok: true });
    for (const method of Object.values(h.service)) expect(method).toHaveBeenCalledOnce();
    h.service.runtime.mockRejectedValueOnce(new Error('/private/runtime/path'));
    expect(JSON.stringify(await h.invoke('runtime'))).not.toContain('/private');
  });
  it('wires the live window lifecycle and preserves the actual IPC event in main', () => {
    const source = readFileSync('src/main/index.ts', 'utf8');
    expect(source).toContain('reaAnalysisWindow = mainWindow;');
    expect(source).toContain("mainWindow.once('closed', () => { if (reaAnalysisWindow === mainWindow) reaAnalysisWindow = null; });");
    expect(source).toContain('registerReaAnalysisIpc({ service: reaAnalysis, ipcMain, getOwnWindow: () => reaAnalysisWindow });');
  });
});
