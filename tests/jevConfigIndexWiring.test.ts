import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('loads persisted config before registering IPC, composing agents or creating a window', () => {
  const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const startup = source.slice(source.indexOf('app.whenReady().then(async () => {'));
  const load = startup.indexOf('await jevConfigStore.load();');
  expect(load).toBeGreaterThan(0);
  expect(startup.indexOf('await installIpcHandlers();')).toBeGreaterThan(load);
  expect(startup.indexOf('createWindow();')).toBeGreaterThan(load);
  expect(source).toContain("new JevConfigStore(app.getPath('userData'))");
  expect(source).toContain('registerJevConfigIpc({ ipcMain, getOwnWindow: () => jevCredentialWindow, store: jevConfigStore })');
});
