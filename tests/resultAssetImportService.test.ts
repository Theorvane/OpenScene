import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { ProjectStore } from '../src/main/projectStore';
import { ResultAssetImportService } from '../src/main/resultAssetImportService';

it('coalesces recording imports and reuses the saved asset after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openscene-recording-import-'));
  try {
    const sourcePath = join(directory, 'recording.webm');
    await writeFile(sourcePath, Buffer.from([1, 2, 3]));
    const projects = new ProjectStore(join(directory, 'projects'));
    const project = await projects.create({ name: 'Recording import' });
    const assets = new AssetLibraryStore(join(directory, 'projects'), projects);
    let calls = 0;
    const dependencies = {
      assets,
      resolveRecordingSource: () => {
        calls += 1;
        return { sourcePath, displayName: 'recording.webm', kind: 'video' as const, mimeType: 'video/webm' };
      }
    };
    const service = new ResultAssetImportService(dependencies);
    const input = { projectId: project.id, sessionId: 'recording-1' };
    const [first, second] = await Promise.all([service.importRecordingResult(input), service.importRecordingResult(input)]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('Recording import failed.');
    expect(second.value.assets[0]?.id).toBe(first.value.assets[0]?.id);
    expect(calls).toBe(1);
    const reopened = new ResultAssetImportService(dependencies);
    expect(await reopened.importRecordingResult(input)).toEqual(first);
    expect(calls).toBe(1);
    const saved = await projects.open(project.id);
    expect(saved?.assets).toHaveLength(1);
    const asset = saved!.assets[0]!;
    expect(asset.resultOrigin).toEqual({ kind: 'recording', resultId: 'recording-1' });
    expect(await readFile(join(directory, 'projects', project.id, asset.projectRelativePath))).toEqual(Buffer.from([1, 2, 3]));
    expect(JSON.stringify(first)).not.toContain(directory);
    expect(await service.importRecordingResult({ ...input, sourcePath })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(calls).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
