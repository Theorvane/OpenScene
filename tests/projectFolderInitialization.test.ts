import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectLocationRegistry } from '../src/main/projectLocations';
import { ProjectStore } from '../src/main/projectStore';

vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>() }));
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'folder-initialize-'));
  roots.push(root);
  const picked = join(root, 'Picked');
  await fs.mkdir(picked);
  const registry = new ProjectLocationRegistry(join(root, 'locations.json'));
  const store = new ProjectStore(join(root, 'internal'), registry);
  return { root, picked, registry, store };
}
function isSnapshotTemporary(path: unknown): boolean {
  return String(path).includes('.project.json.') && String(path).endsWith('.tmp');
}

describe('non-destructive folder initialization', () => {
  it('publishes one complete project for concurrent callers across store instances', async () => {
    const { root, picked, registry } = await fixture();
    const originalOpen = fs.open;
    let arrivals = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (isSnapshotTemporary(args[0])) {
        arrivals += 1;
        if (arrivals === 8) release();
        await ready;
      }
      return originalOpen(...args);
    });
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      new ProjectStore(join(root, 'internal'), registry).openOrInitializeFolder(picked)));
    expect(results.every((result) => result !== null)).toBe(true);
    expect(new Set(results.map((result) => result?.project.id)).size).toBe(1);
    expect(results.filter((result) => result?.created).length).toBe(1);
    const saved = JSON.parse(await fs.readFile(join(picked, 'project.json'), 'utf8'));
    expect(saved.id).toBe(results[0]?.project.id);
    expect(await registry.entries()).toEqual(new Map([[saved.id, picked]]));
    expect(await fs.readdir(picked)).toEqual(['project.json']);
  });

  it('preserves a newly initialized project after registry failure and reopens it on retry', async () => {
    const { picked, registry, store } = await fixture();
    vi.spyOn(registry, 'register').mockRejectedValueOnce(new Error('registry unavailable'));
    await expect(store.openOrInitializeFolder(picked)).rejects.toThrow('registry unavailable');
    const bytes = await fs.readFile(join(picked, 'project.json'), 'utf8');
    const result = await store.openOrInitializeFolder(picked);
    expect(result?.created).toBe(false);
    expect(result?.project.id).toBe(JSON.parse(bytes).id);
    expect(await fs.readFile(join(picked, 'project.json'), 'utf8')).toBe(bytes);
    expect(await registry.get(JSON.parse(bytes).id)).toBe(picked);
  });

  it('never replaces a file that arrives between the initial read and publication', async () => {
    const { picked, registry, store } = await fixture();
    const originalOpen = fs.open;
    const foreign = '{"newer":"unrecognized project from another writer"}\n';
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (isSnapshotTemporary(args[0])) await fs.writeFile(join(picked, 'project.json'), foreign, { flag: 'wx' });
      return originalOpen(...args);
    });
    expect(await store.openOrInitializeFolder(picked)).toBeNull();
    expect(await fs.readFile(join(picked, 'project.json'), 'utf8')).toBe(foreign);
    expect(await registry.entries()).toEqual(new Map());
    expect(await fs.readdir(picked)).toEqual(['project.json']);
  });

  it('reopens a valid project published after the initial read', async () => {
    const { picked, registry, store } = await fixture();
    const winner = await store.create({ name: 'Concurrent winner' });
    const bytes = await fs.readFile(join(await store.resolveDirectory(winner.id), 'project.json'), 'utf8');
    const originalOpen = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (isSnapshotTemporary(args[0])) await fs.writeFile(join(picked, 'project.json'), bytes, { flag: 'wx' });
      return originalOpen(...args);
    });
    const result = await store.openOrInitializeFolder(picked);
    expect(result).toEqual({ project: winner, created: false });
    expect(await fs.readFile(join(picked, 'project.json'), 'utf8')).toBe(bytes);
    expect(await registry.entries()).toEqual(new Map([[winner.id, picked]]));
    expect(await fs.readdir(picked)).toEqual(['project.json']);
  });

  it('fails safely without replacing fallback when exclusive publication is unsupported', async () => {
    const { picked, registry, store } = await fixture();
    vi.spyOn(fs, 'link').mockRejectedValueOnce(Object.assign(new Error('link unsupported'), { code: 'ENOTSUP' }));
    const rename = vi.spyOn(fs, 'rename');
    await expect(store.openOrInitializeFolder(picked)).rejects.toMatchObject({ code: 'ENOTSUP' });
    expect(rename).not.toHaveBeenCalled();
    expect(await fs.readdir(picked)).toEqual([]);
    expect(await registry.entries()).toEqual(new Map());
    expect((await store.openOrInitializeFolder(picked))?.created).toBe(true);
  });

  it('removes a written temporary snapshot when sync fails before publication', async () => {
    const { picked, store } = await fixture();
    const originalOpen = fs.open;
    const failure = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (isSnapshotTemporary(args[0])) vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('sync failed'));
      return handle;
    });
    await expect(store.openOrInitializeFolder(picked)).rejects.toThrow('sync failed');
    expect(await fs.readdir(picked)).toEqual([]);
    failure.mockRestore();
    expect((await store.openOrInitializeFolder(picked))?.created).toBe(true);
  });

  it('preserves existing invalid files, directories and dangling symlinks', async () => {
    const { root, picked, registry, store } = await fixture();
    const file = join(picked, 'project.json');
    await fs.writeFile(file, 'corrupt or newer format');
    expect(await store.openOrInitializeFolder(picked)).toBeNull();
    expect(await fs.readFile(file, 'utf8')).toBe('corrupt or newer format');
    await fs.rm(file);
    await fs.mkdir(file);
    expect(await store.openOrInitializeFolder(picked)).toBeNull();
    expect((await fs.lstat(file)).isDirectory()).toBe(true);
    await fs.rm(file, { recursive: true });
    const target = join(root, 'not-created');
    await fs.symlink(target, file);
    // Rejecting a symlink is also safe; its entry and target must not change.
    await store.openOrInitializeFolder(picked).catch(() => null);
    expect((await fs.lstat(file)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(file)).toBe(target);
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await registry.entries()).toEqual(new Map());
  });

  it('cleans staging files after a failed write and permits a fresh retry', async () => {
    const { picked, store } = await fixture();
    const originalOpen = fs.open;
    const failure = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (isSnapshotTemporary(args[0]) && typeof args[1] === 'number' && (args[1] & constants.O_CREAT)) {
        throw new Error('staging unavailable');
      }
      return originalOpen(...args);
    });
    await expect(store.openOrInitializeFolder(picked)).rejects.toThrow('staging unavailable');
    expect(await fs.readdir(picked)).toEqual([]);
    failure.mockRestore();
    expect((await store.openOrInitializeFolder(picked))?.created).toBe(true);
  });
});
