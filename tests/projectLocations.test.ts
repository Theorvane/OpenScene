import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectLocationRegistry } from '../src/main/projectLocations';

vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'project-locations-'));
  roots.push(root);
  const path = join(root, 'locations.json');
  return { root, path, store: new ProjectLocationRegistry(path) };
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe('project location transactions', () => {
  it('retains concurrent registrations on a cold registry, including after reload', async () => {
    const { root, path, store } = await fixture();
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.register(`project-${i}`, join(root, `folder-${i}`))));
    const expected = new Map(Array.from({ length: 12 }, (_, i) => [`project-${i}`, join(root, `folder-${i}`)]));
    expect(await store.entries()).toEqual(expected);
    expect(await new ProjectLocationRegistry(path).entries()).toEqual(expected);
  });

  it('keeps the committed cache and removes temporary files after rename failure', async () => {
    const { root, path, store } = await fixture();
    await store.register('old', join(root, 'old'));
    const original = await readFile(path, 'utf8');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'));
    await expect(store.register('new', join(root, 'new'))).rejects.toThrow('rename failed');
    expect(await store.get('new')).toBeNull();
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await readdir(root)).toEqual(['locations.json']);
    await store.register('retry', join(root, 'retry'));
    expect(await new ProjectLocationRegistry(path).entries()).toEqual(new Map([
      ['old', join(root, 'old')], ['retry', join(root, 'retry')]
    ]));
  });

  it('does not remove a committed mapping when unregister persistence fails', async () => {
    const { root, path, store } = await fixture();
    await store.register('old', root);
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'));
    await expect(store.unregister('old')).rejects.toThrow('rename failed');
    expect(await store.get('old')).toBe(root);
    expect(await new ProjectLocationRegistry(path).get('old')).toBe(root);
    expect(await store.unregister('old')).toBe(true);
    expect(await store.unregister('old')).toBe(false);
  });

  it('orders registrations, deletions and subsequent reads by invocation', async () => {
    const { root, path, store } = await fixture();
    await store.entries();
    const add = store.register('project', root);
    const remove = store.unregister('project');
    const observed = store.get('project');
    await add;
    expect(await remove).toBe(true);
    expect(await observed).toBeNull();
    expect(await new ProjectLocationRegistry(path).get('project')).toBeNull();
  });

  it('does not let an earlier rename overwrite a newer committed mapping', async () => {
    const { root, path, store } = await fixture();
    await store.entries();
    const started = gate();
    const held = gate();
    const rename = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementationOnce(async (...args) => {
      started.release();
      await held.promise;
      return rename(...args);
    });
    const first = store.register('project', join(root, 'first'));
    await started.promise;
    const second = store.register('project', join(root, 'second'));
    held.release();
    await Promise.all([first, second]);
    expect(await store.get('project')).toBe(join(root, 'second'));
    expect(await new ProjectLocationRegistry(path).get('project')).toBe(join(root, 'second'));
  });

  it('waits for a pending commit before resolving later reads', async () => {
    const { root, store } = await fixture();
    await store.entries();
    const started = gate();
    const held = gate();
    const rename = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementationOnce(async (...args) => {
      started.release();
      await held.promise;
      return rename(...args);
    });
    const saving = store.register('project', root);
    await started.promise;
    let resolved = false;
    const reading = store.get('project').then((value) => { resolved = true; return value; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const resolvedBeforeCommit = resolved;
    held.release();
    await saving;
    expect(await reading).toBe(root);
    expect(resolvedBeforeCommit).toBe(false);
  });

  it('cleans partial temporary writes and recovers without publishing the failed candidate', async () => {
    const { root, path, store } = await fixture();
    await store.register('old', root);
    const write = fs.writeFile;
    vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => {
      await write(args[0], 'partial');
      throw new Error('disk full');
    });
    await expect(store.register('new', root)).rejects.toThrow('disk full');
    expect(await store.get('new')).toBeNull();
    expect(await readdir(root)).toEqual(['locations.json']);
    expect(await new ProjectLocationRegistry(path).get('old')).toBe(root);
    await store.register('retry', root);
    expect(await store.get('retry')).toBe(root);
  });

  it('recovers after a load failure and does not globally block independent registries', async () => {
    const { root, path, store } = await fixture();
    await mkdir(path);
    await expect(store.register('project', root)).rejects.toThrow();
    await rm(path, { recursive: true });
    const other = await fixture();
    await other.store.register('other', other.root);
    await store.register('project', root);
    expect(await store.get('project')).toBe(root);
  });

  it('preserves the existing file schema and validation', async () => {
    const { root, path, store } = await fixture();
    await writeFile(path, JSON.stringify({ schemaVersion: 1, locations: { valid: root, invalid: 'relative' } }));
    expect(await store.entries()).toEqual(new Map([['valid', root]]));
    await expect(store.register('bad/id', root)).rejects.toThrow('Invalid project id');
    await expect(store.register('valid', 'relative')).rejects.toThrow('absolute');
    await store.register('next', root);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ schemaVersion: 1, locations: { valid: root, next: root } });
  });
});
