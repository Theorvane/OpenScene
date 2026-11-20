import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';

/** Bounds reference-image disk reads as well as the eventual IPC payload. */
export const REFERENCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export class ReferenceImageTooLargeError extends Error {}

/** Caller retains ownership of the already approved handle, including closing it. */
export async function readBoundedReferenceImageHandle(file: FileHandle): Promise<Buffer> {
  const stats = await file.stat();
  if (!stats.isFile()) throw new Error('Reference image must be a regular file.');
  if (stats.size > REFERENCE_IMAGE_MAX_BYTES) throw new ReferenceImageTooLargeError();

  // The file may grow after stat. Read at most the limit plus one detection
  // byte, never using an unbounded readFile on this handle.
  const buffer = Buffer.allocUnsafe(REFERENCE_IMAGE_MAX_BYTES + 1);
  let total = 0;
  while (total <= REFERENCE_IMAGE_MAX_BYTES) {
    const { bytesRead } = await file.read(buffer, total, Math.min(64 * 1024, buffer.length - total), total);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > REFERENCE_IMAGE_MAX_BYTES) throw new ReferenceImageTooLargeError();
  }
  return buffer.subarray(0, total);
}

export async function readBoundedReferenceImage(filePath: string): Promise<Buffer> {
  // Non-blocking open lets stat reject special files such as FIFOs without
  // waiting for a writer in the main process.
  const file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    return await readBoundedReferenceImageHandle(file);
  } finally {
    await file.close();
  }
}
