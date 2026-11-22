import { execFileSync } from 'node:child_process';
import { closeSync, constants, openSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ProjectStore } from '../src/main/projectStore';
import { PROJECT_FILE_NAME, readProjectSnapshot, readProjectSnapshotAtDirectory } from '../src/main/projectStoreSupport';

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'openscene-project-special-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// A failing baseline must not leave an open() worker blocked after the test.
// The writer is connected only AFTER the deadline/assertion, never during the
// behavior under test. O_RDWR | O_NONBLOCK makes cleanup itself nonblocking.
async function withoutWriter<T>(fifo: string, run: () => Promise<T>): Promise<T> {
  const pending = run();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      pending.then((value) => ({ completed: true as const, value })),
      new Promise<{ completed: false }>((resolve) => {
        timer = setTimeout(() => resolve({ completed: false }), 1_000);
      })
    ]);
    expect(result.completed, 'snapshot read must settle without any FIFO writer').toBe(true);
    if (!result.completed) throw new Error('Snapshot read blocked');
    return result.value;
  } finally {
    clearTimeout(timer);
    const release = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);
    closeSync(release);
    await pending;
  }
}

// POSIX named pipes/symlinks are exercised natively, not simulated by mocks.
describe.skipIf(process.platform === 'win32')('project snapshot special files', () => {
  for (const mode of ['picked folder', 'internal project', 'project listing'] as const) {
    it(`rejects a writerless FIFO during ${mode} without hiding healthy projects`, async () => {
      await withRoot(async (root) => {
        const store = new ProjectStore(root);
        const healthy = await store.create({ name: 'Healthy project' });
        const badDirectory = join(root, 'fifo-project');
        await mkdir(badDirectory);
        const fifo = join(badDirectory, PROJECT_FILE_NAME);
        execFileSync('mkfifo', [fifo]);

        if (mode === 'picked folder') {
          expect(await withoutWriter(fifo, () => readProjectSnapshotAtDirectory(badDirectory, null))).toBeNull();
        } else if (mode === 'internal project') {
          expect(await withoutWriter(fifo, () => readProjectSnapshot(root, 'fifo-project'))).toBeNull();
        } else {
          const projects = await withoutWriter(fifo, () => store.list());
          expect(projects.map((project) => project.id)).toEqual([healthy.id]);
        }
      });
    });
  }

  it('still reads regular snapshots and rejects symlink snapshots', async () => {
    await withRoot(async (root) => {
      const store = new ProjectStore(root);
      const project = await store.create({ name: 'Regular project' });
      const directory = join(root, project.id);
      expect(await readProjectSnapshotAtDirectory(directory, null)).toEqual(project);
      const linkedDirectory = join(root, 'linked-project');
      await mkdir(linkedDirectory);
      await symlink(join(directory, PROJECT_FILE_NAME), join(linkedDirectory, PROJECT_FILE_NAME));
      expect(await readProjectSnapshotAtDirectory(linkedDirectory, null)).toBeNull();
    });
  });
});
