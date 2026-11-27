import { readFileSync } from 'node:fs';
import { transformWithEsbuild } from 'vite';
import { expect, it, vi } from 'vitest';
import { fail, ok } from '../src/main/ipcResponses';
import { REA_VIDEO_CREDENTIAL_SLOT } from '../src/shared/reaGenerationApi';

it('denies the reserved slot in the actual generic index handler before any store access', async () => {
  const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  ipcMain.handle(IPC_CHANNELS.setProviderCredential,');
  const end = source.indexOf('\n  const mcpServerInstance', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const { code } = await transformWithEsbuild(source.slice(start, end), 'jev-index-handler.ts', { loader: 'ts', target: 'es2022' });
  let handler: (...args: unknown[]) => Promise<unknown> = async () => { throw new Error('not registered'); };
  const store = { setCredential: vi.fn(async () => {}) };
  new Function('ipcMain', 'IPC_CHANNELS', 'credentialStore', 'ok', 'fail', 'REA_VIDEO_CREDENTIAL_SLOT', code)(
    { handle: (_channel: string, callback: typeof handler) => { handler = callback; } },
    { setProviderCredential: 'credentials:set' }, store, ok, fail, REA_VIDEO_CREDENTIAL_SLOT);
  for (const event of [{}, { sender: {}, senderFrame: {} }]) {
    expect(await handler(event, 'typesafe-jev', 'secret')).toEqual(fail('PERMISSION_DENIED', 'Use the dedicated Jev credential operation.'));
    expect(await handler(event, REA_VIDEO_CREDENTIAL_SLOT, 'fake-video-key')).toEqual(fail('PERMISSION_DENIED', 'Use the dedicated video credential operation.'));
  }
  for (const provider of [['typesafe-jev'], [REA_VIDEO_CREDENTIAL_SLOT], null, {}, { toString: () => 'typesafe-jev' }, { toString: () => REA_VIDEO_CREDENTIAL_SLOT }]) {
    expect(await handler({}, provider, 'secret')).toEqual(fail('INVALID_INPUT', 'Invalid credential provider.'));
  }
  expect(store.setCredential).not.toHaveBeenCalled();
  expect(await handler({}, 'openaiApiKey', 'ordinary')).toEqual(ok({ updated: true }));
  expect(store.setCredential).toHaveBeenCalledExactlyOnceWith('openaiApiKey', 'ordinary');
  expect(source).toContain('registerJevCredentialIpc({ ipcMain, getOwnWindow: () => jevCredentialWindow, service: jevService })');
  expect(source).toContain('if (jevCredentialWindow === mainWindow) jevCredentialWindow = null');
});
