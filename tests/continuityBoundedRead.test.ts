import { mkdtemp, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => ({ unboundedReads: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: (...args: Parameters<typeof actual.readFile>) => {
    control.unboundedReads += 1;
    return actual.readFile(...args);
  } };
});

import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { ContinuityFrameService } from '../src/main/continuityFrameService';
import { ProjectStore } from '../src/main/projectStore';
import { REFERENCE_IMAGE_MAX_BYTES } from '../src/main/referenceImagePicker';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  control.unboundedReads = 0;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(kind: 'image' | 'video' = 'image') {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-limit-'));
  directories.push(directory);
  const root = join(directory, 'projects');
  const projects = new ProjectStore(root);
  const assets = new AssetLibraryStore(root, projects);
  const project = await projects.create({ name: 'Synthetic' });
  const sourcePath = join(directory, kind === 'image' ? 'input.jpg' : 'input.mp4');
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
  await writeFile(sourcePath, bytes);
  const imported = await assets.import({ projectId: project.id, sourcePath, displayName: 'Synthetic', kind, mimeType: kind === 'image' ? 'image/jpeg' : 'video/mp4' });
  const asset = await assets.updateMetadata({ projectId: project.id, assetId: imported.id, durationMs: kind === 'video' ? 8_000 : 0 });
  return { directory, projects, assets, project, asset, bytes };
}

function sourceFile(contents: number, failure?: 'stat' | 'read') {
  let remaining = contents;
  let consumed = 0;
  const stat = vi.fn(async () => {
    if (failure === 'stat') throw new Error('/private/stat');
    return { size: 6, isFile: () => true };
  });
  const read = vi.fn(async (buffer: Buffer, offset: number, length: number) => {
    if (failure === 'read') throw new Error('/private/read');
    const bytesRead = Math.min(length, remaining);
    buffer.fill(42, offset, offset + bytesRead);
    if (consumed === 0 && bytesRead >= 3) buffer.set([0xff, 0xd8, 0xff], offset);
    consumed += bytesRead;
    remaining -= bytesRead;
    return { buffer, bytesRead };
  });
  const readFile = vi.fn(async () => {
    const bytes = Buffer.alloc(contents, 42);
    bytes.set([0xff, 0xd8, 0xff]);
    return bytes;
  });
  const close = vi.fn(async () => {});
  return { file: { stat, read, readFile, close } as unknown as FileHandle, read, readFile, close, consumed: () => consumed };
}

async function referenceWithFile(contents: number, failure?: 'stat' | 'read') {
  const f = await fixture();
  const source = sourceFile(contents, failure);
  vi.spyOn(f.assets, 'openPlaybackSource').mockResolvedValue({ file: source.file, filePath: '/private/approved.jpg', mimeType: 'image/jpeg', byteLength: 6 });
  const service = new ContinuityFrameService(f);
  const response = await service.getReference({ projectId: f.project.id, assetId: f.asset.id });
  return { source, response };
}

describe('continuity reference byte limits', () => {
  it('caps an image that grows after source metadata was captured without unbounded reads', async () => {
    const { source, response } = await referenceWithFile(REFERENCE_IMAGE_MAX_BYTES + 100);
    expect(response).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(source.readFile).not.toHaveBeenCalled();
    expect(source.consumed()).toBe(REFERENCE_IMAGE_MAX_BYTES + 1);
    expect(source.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(response)).not.toContain('/private');
  });

  it('accepts exactly the limit using the approved handle without reopening its path', async () => {
    const { source, response } = await referenceWithFile(REFERENCE_IMAGE_MAX_BYTES);
    expect(response.ok).toBe(true);
    expect(response.ok && Buffer.from(response.value.base64, 'base64').byteLength).toBe(REFERENCE_IMAGE_MAX_BYTES);
    expect(source.readFile).not.toHaveBeenCalled();
    expect(source.close).toHaveBeenCalledOnce();
  });

  it.each(['stat', 'read'] as const)('closes after %s failure without exposing paths', async (failure) => {
    const { source, response } = await referenceWithFile(6, failure);
    expect(response).toMatchObject({ ok: false, error: { code: 'ASSET_NOT_FOUND' } });
    expect(source.readFile).not.toHaveBeenCalled();
    expect(source.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(response)).not.toContain('/private');
  });

  it('retries an oversized extracted JPEG without reading its entire contents', async () => {
    const f = await fixture('video');
    let attempts = 0;
    let unboundedExtractionReads = -1;
    const service = new ContinuityFrameService({ ...f, temporaryRoot: f.directory,
      discoverFfmpeg: async () => ({ kind: 'system', executablePath: 'synthetic-only' }),
      runExtraction: async ({ outputPath }) => {
        if (attempts === 0) control.unboundedReads = 0;
        if (attempts === 1) unboundedExtractionReads = control.unboundedReads;
        attempts += 1;
        await writeFile(outputPath, attempts === 1 ? Buffer.alloc(REFERENCE_IMAGE_MAX_BYTES + 1, 42) : f.bytes);
      }
    });
    const response = await service.extract({ projectId: f.project.id, assetId: f.asset.id });
    expect(response.ok).toBe(true);
    expect(attempts).toBe(2);
    expect(unboundedExtractionReads).toBe(0);
  });
});
