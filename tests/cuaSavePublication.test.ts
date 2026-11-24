import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { ProjectStore } from '../src/main/projectStore';

it('checks authority only after staging and rejects publication without changing the saved project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cua-save-publication-'));
  try {
    const store = new ProjectStore(root), project = await store.create({ name: 'Approved save' });
    const file = join(root, project.id, 'project.json'), before = await readFile(file, 'utf8');
    let guardCalls = 0;
    await expect(store.saveTimeline(project.id, project.timeline, new Date(), current => {
      guardCalls++; expect(current.id).toBe(project.id); throw new Error('CUA_CANCELLED');
    })).rejects.toThrow('CUA_CANCELLED');
    expect(guardCalls).toBe(1);
    expect(await readFile(file, 'utf8')).toBe(before);
    expect((await readdir(join(root, project.id))).filter(name => name.endsWith('.tmp'))).toEqual([]);
    const saved = await store.saveTimeline(project.id, project.timeline);
    expect(saved.id).toBe(project.id); // Ordinary saves retain their existing behavior.
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects an accidentally asynchronous guard before the atomic rename', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cua-save-sync-'));
  try {
    const store = new ProjectStore(root), project = await store.create({ name: 'Guard contract' });
    const file = join(root, project.id, 'project.json'), before = await readFile(file, 'utf8');
    await expect(store.saveTimeline(project.id, project.timeline, new Date(), async () => undefined)).rejects.toThrow('must be synchronous');
    expect(await readFile(file, 'utf8')).toBe(before);
    expect((await readdir(join(root, project.id))).filter(name => name.endsWith('.tmp'))).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
