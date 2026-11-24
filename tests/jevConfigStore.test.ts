import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JevConfigStore } from '../src/main/jevConfigStore';
import { DEFAULT_JEV_CONFIG, parseJevConfig } from '../src/shared/jevConfig';
import { createJevRuntime } from '../src/main/jevRuntime';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), open: vi.fn(actual.open) };
});

describe('persisted Jev configuration', () => {
  let directory: string;
  let store: JevConfigStore;
  const enabled = { ...DEFAULT_JEV_CONFIG, enabled: true };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'openscene-jev-config-'));
    store = new JevConfigStore(directory);
  });
  afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

  it('starts off, reloads validated config and resets through explicit defaults', async () => {
    expect(store.getSnapshot().enabled).toBe(false);
    await store.load();
    await store.set(enabled);
    const reload = new JevConfigStore(directory);
    expect(reload.getSnapshot().enabled).toBe(false);
    expect((await reload.load()).enabled).toBe(true);
    await reload.set(DEFAULT_JEV_CONFIG);
    expect((await new JevConfigStore(directory).load()).enabled).toBe(false);
    expect(await readdir(directory)).toEqual(['jev-judgment-config.json']);
  });

  it('rejects extra fields, partial and invalid values without persistence', async () => {
    for (const value of [null, [], {}, { ...enabled, apiKey: 'synthetic' },
      { ...enabled, timeoutMs: 5001 }, { ...enabled, minSelectedProbability: NaN },
      { ...enabled, model: 'other' }]) {
      expect(parseJevConfig(value)).toBeNull();
      await expect(store.set(value)).rejects.toThrow('Invalid Jev configuration.');
    }
    expect(await readdir(directory)).toEqual([]);
    expect(store.getSnapshot().enabled).toBe(false);
  });

  it('disables on corrupt or unknown persisted content', async () => {
    for (const content of ['{broken', JSON.stringify({ ...enabled, apiKey: 'synthetic' }), 'null']) {
      await store.set(enabled);
      await writeFile(join(directory, 'jev-judgment-config.json'), content);
      expect((await store.load()).enabled).toBe(false);
    }
  });

  it('publishes only after rename and queues competing load/set calls in invocation order', async () => {
    await store.set(DEFAULT_JEV_CONFIG);
    const runtime = createJevRuntime({ service: { getApiKey: async () => null }, readConfig: store.getSnapshot });
    const rename = vi.mocked(fs.rename).getMockImplementation()!;
    let reached!: () => void;
    let release!: () => void;
    const atRename = new Promise<void>((resolve) => { reached = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fs.rename).mockImplementationOnce(async (...args) => { reached(); await held; return rename(...args); });
    const first = store.set(enabled);
    await atRename;
    const load = store.load();
    const last = store.set({ ...enabled, timeoutMs: 4000 });
    try {
      expect(runtime.getConfig().enabled).toBe(false);
      expect((await new JevConfigStore(directory).load()).enabled).toBe(false);
    } finally { release(); }
    await first;
    expect((await load).timeoutMs).toBe(2500);
    await last;
    expect(runtime.getConfig().timeoutMs).toBe(4000);
    expect((await new JevConfigStore(directory).load()).timeoutMs).toBe(4000);
  });

  it('retains committed disk and snapshot on replacement failure, then recovers', async () => {
    await store.set(DEFAULT_JEV_CONFIG);
    const previous = await readFile(join(directory, 'jev-judgment-config.json'));
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('synthetic-private-error'));
    await expect(store.set(enabled)).rejects.toThrow('synthetic-private-error');
    expect(store.getSnapshot().enabled).toBe(false);
    expect(await readFile(join(directory, 'jev-judgment-config.json'))).toEqual(previous);
    expect(await readdir(directory)).toEqual(['jev-judgment-config.json']);
    await store.set(enabled);
    expect(store.getSnapshot().enabled).toBe(true);
  });

  it('does not publish when fsync fails and removes its temporary file', async () => {
    await store.set(DEFAULT_JEV_CONFIG);
    const open = vi.mocked(fs.open).getMockImplementation()!;
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const file = await open(...args);
      vi.spyOn(file, 'sync').mockRejectedValueOnce(new Error('synthetic-sync-failure'));
      return file;
    });
    await expect(store.set(enabled)).rejects.toThrow('synthetic-sync-failure');
    expect(store.getSnapshot().enabled).toBe(false);
    expect((await new JevConfigStore(directory).load()).enabled).toBe(false);
    expect(await readdir(directory)).toEqual(['jev-judgment-config.json']);
  });

  it.skipIf(process.platform === 'win32')('uses owner-only file permissions', async () => {
    await store.set(enabled);
    expect((await stat(join(directory, 'jev-judgment-config.json'))).mode & 0o777).toBe(0o600);
  });
});
