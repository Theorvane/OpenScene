import { mkdtemp, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => ({ file: undefined as FileHandle | undefined, unboundedReads: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: (...args: Parameters<typeof actual.open>) => control.file ? Promise.resolve(control.file) : actual.open(...args),
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      control.unboundedReads += 1;
      return actual.readFile(...args);
    }
  };
});

import { REFERENCE_IMAGE_MAX_BYTES, selectReferenceImage } from '../src/main/referenceImagePicker';

const directories: string[] = [];
const dialog = (path: string) => async () => ({ canceled: false, filePaths: [path] });
async function image(bytes: Buffer): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'reference-image-limit-'));
  directories.push(directory);
  const path = join(directory, 'image.PNG');
  await writeFile(path, bytes);
  return path;
}

function fakeFile(size: number, contents: number = size, regular = true, chunkSize = Number.POSITIVE_INFINITY) {
  let remaining = contents;
  let requested = 0;
  const read = vi.fn(async (buffer: Buffer, offset: number, length: number) => {
    requested += length;
    const bytesRead = Math.min(length, remaining, chunkSize);
    buffer.fill(42, offset, offset + bytesRead);
    remaining -= bytesRead;
    return { bytesRead, buffer };
  });
  const stat = vi.fn(async () => ({ size, isFile: () => regular }));
  const close = vi.fn(async () => {});
  control.file = { read, stat, close } as unknown as FileHandle;
  return { read, stat, close, requested: () => requested };
}

afterEach(async () => {
  control.file = undefined;
  control.unboundedReads = 0;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('default reference image disk reader', () => {
  it('preserves actual small-file bytes without an unbounded read', async () => {
    const bytes = Buffer.from([0, 1, 255, 42]);
    const response = await selectReferenceImage(dialog(await image(bytes)));
    expect(response).toEqual({ ok: true, value: { displayName: 'image.PNG', mimeType: 'image/png', base64: bytes.toString('base64') } });
    expect(control.unboundedReads).toBe(0);
  });

  it('accepts a real file exactly at the existing byte limit', async () => {
    const bytes = Buffer.alloc(REFERENCE_IMAGE_MAX_BYTES, 42);
    const response = await selectReferenceImage(dialog(await image(bytes)));
    expect(response.ok && response.value?.base64).toBe(bytes.toString('base64'));
  });

  it('rejects a real oversized file without unbounded reading', async () => {
    const response = await selectReferenceImage(dialog(await image(Buffer.alloc(REFERENCE_IMAGE_MAX_BYTES + 1))));
    expect(response.ok || response.error.message).toContain('larger than 8MB');
    expect(control.unboundedReads).toBe(0);
  });

  it('rejects known oversized metadata before reading, and closes the handle', async () => {
    const file = fakeFile(REFERENCE_IMAGE_MAX_BYTES * 100);
    const response = await selectReferenceImage(dialog('/private/huge.png'));
    expect(response.ok || response.error.message).toContain('larger than 8MB');
    expect(file.read).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('bounds bytes even when the file grows after stat', async () => {
    const file = fakeFile(1, REFERENCE_IMAGE_MAX_BYTES * 100);
    const response = await selectReferenceImage(dialog('/private/growing.png'));
    expect(response.ok || response.error.message).toContain('larger than 8MB');
    expect(file.requested()).toBe(REFERENCE_IMAGE_MAX_BYTES + 1);
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('rejects non-regular input without reading and closes it', async () => {
    const file = fakeFile(0, 0, false);
    const response = await selectReferenceImage(dialog('/private/directory.png'));
    expect(response).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'The reference image could not be read.' } });
    expect(file.read).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('closes the handle after a stat failure without leaking error details', async () => {
    const file = fakeFile(1);
    file.stat.mockRejectedValueOnce(new Error('/private/sensitive.png stat failed'));
    const response = await selectReferenceImage(dialog('/private/sensitive.png'));
    expect(response.ok).toBe(false);
    expect(JSON.stringify(response)).not.toContain('/private');
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('closes the handle after a read failure without leaking error details', async () => {
    const file = fakeFile(1);
    file.read.mockRejectedValueOnce(new Error('/private/sensitive.png read failed'));
    const response = await selectReferenceImage(dialog('/private/sensitive.png'));
    expect(response.ok).toBe(false);
    expect(JSON.stringify(response)).not.toContain('/private');
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('assembles repeated partial reads without exposing unused buffer bytes', async () => {
    const file = fakeFile(4, 4, true, 1);
    const response = await selectReferenceImage(dialog('/private/partial.png'));
    expect(response.ok && response.value?.base64).toBe(Buffer.alloc(4, 42).toString('base64'));
    expect(file.read).toHaveBeenCalledTimes(5);
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('fails safely if closing the opened file fails', async () => {
    const file = fakeFile(4);
    file.close.mockRejectedValueOnce(new Error('/private/close-failed.png'));
    const response = await selectReferenceImage(dialog('/private/close-failed.png'));
    expect(response.ok).toBe(false);
    expect(JSON.stringify(response)).not.toContain('/private');
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('closes the handle after a successful short read', async () => {
    const file = fakeFile(4);
    const response = await selectReferenceImage(dialog('/private/small.png'));
    expect(response.ok && response.value?.base64).toBe(Buffer.alloc(4, 42).toString('base64'));
    expect(file.close).toHaveBeenCalledOnce();
  });
});
