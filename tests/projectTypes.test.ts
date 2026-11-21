import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../src/main/projectStore';
import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { TimelineIpcService } from '../src/main/timelineIpcService';
import { parsePersistedProject } from '../src/main/projectSnapshotCodec';
import { ProjectLocationRegistry } from '../src/main/projectLocations';
import { mkdir } from 'node:fs/promises';

describe('persisted project types', () => {
  it('uses the selected type only for new folders and validates IPC before opening a dialog', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openscene-folder-types-'));
    try {
      const folder = join(directory, 'chosen'); await mkdir(folder);
      const projects = new ProjectStore(join(directory, 'projects'), new ProjectLocationRegistry(join(directory, 'locations.json')));
      let dialogs = 0;
      const service = new TimelineIpcService({ projects, assets: new AssetLibraryStore(join(directory, 'projects'), projects),
        selectProjectDirectory: async () => { dialogs++; return { canceled: false, filePaths: [folder] }; } });
      expect((await service.openProjectFolder({ projectType: 'bad' })).ok).toBe(false);
      expect(dialogs).toBe(0);
      const created = await service.openProjectFolder({ projectType: 'generation' });
      expect(created.ok && !created.value.cancelled && created.value.project.projectType).toBe('generation');
      const reopened = await service.openProjectFolder({ projectType: 'editing' });
      expect(reopened.ok && !reopened.value.cancelled && reopened.value.project.projectType).toBe('generation');
      expect((await projects.list())[0]?.projectType).toBe('generation');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
