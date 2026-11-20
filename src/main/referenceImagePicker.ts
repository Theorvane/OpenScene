import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import type { ApiResponse } from '../shared/models';
import type { ReferenceImageSelection } from '../shared/providerSeams';
import { fail, ok } from './ipcResponses';

/**
 * Reference image for image-to-video generation. The picker lives in the main
 * process because the renderer has no filesystem access: it returns the bytes
 * inline as base64 rather than a path, so the renderer never learns where the
 * file lives and the provider adapter can post it directly.
 */
export const REFERENCE_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

/** Provider limits are far lower; this bounds disk reads as well as IPC bytes. */
export const REFERENCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

export type ReferenceImageDialog = () => Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;

export type ReferenceImageReader = (filePath: string) => Promise<Buffer>;

class ReferenceImageTooLargeError extends Error {}

function tooLargeResponse(): ApiResponse<ReferenceImageSelection | null> {
  return fail('INVALID_INPUT', `The reference image is larger than ${REFERENCE_IMAGE_MAX_BYTES / (1024 * 1024)}MB.`);
}

async function readBoundedReferenceImage(filePath: string): Promise<Buffer> {
  // Non-blocking open lets stat reject special files such as FIFOs without
  // waiting for a writer in the main process.
  const file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
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
  } finally {
    await file.close();
  }
}

export async function selectReferenceImage(
  showDialog: ReferenceImageDialog,
  read: ReferenceImageReader = readBoundedReferenceImage
): Promise<ApiResponse<ReferenceImageSelection | null>> {
  const selection = await showDialog();
  const filePath = selection.canceled ? undefined : selection.filePaths[0];
  if (filePath === undefined) return ok(null);

  const mimeType = MIME_TYPES[extname(filePath).toLowerCase()];
  if (mimeType === undefined) {
    return fail('INVALID_INPUT', `Reference images must be one of: ${REFERENCE_IMAGE_EXTENSIONS.join(', ')}.`);
  }

  try {
    const bytes = await read(filePath);
    if (bytes.byteLength > REFERENCE_IMAGE_MAX_BYTES) {
      return tooLargeResponse();
    }
    return ok({ displayName: basename(filePath), mimeType, base64: bytes.toString('base64') });
  } catch (error) {
    if (error instanceof ReferenceImageTooLargeError) return tooLargeResponse();
    return fail('INVALID_INPUT', 'The reference image could not be read.');
  }
}
