import { createHash } from 'node:crypto';
import type { ReferenceImageSelection } from '../shared/providerSeams';
import { REFERENCE_IMAGE_MAX_BYTES } from './referenceImagePicker';

/** Main-process only. Never include this identity or source metadata in progress logs. */
export function prepareGoogleFlowReference(reference: ReferenceImageSelection): {
  readonly bytes: Buffer;
  readonly fileName: string;
} {
  const extension = reference.mimeType === 'image/png' ? 'png'
    : reference.mimeType === 'image/jpeg' ? 'jpg'
      : reference.mimeType === 'image/webp' ? 'webp' : undefined;
  if (extension === undefined) throw new Error('Google Flow reference image type is not supported.');
  if (reference.base64.length > Math.ceil(REFERENCE_IMAGE_MAX_BYTES / 3) * 4) {
    throw new Error('Google Flow reference image exceeds the upload size limit.');
  }
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(reference.base64) || reference.base64.length % 4 === 1) {
    throw new Error('Google Flow reference image is not valid base64 data.');
  }
  const bytes = Buffer.from(reference.base64, 'base64');
  if (bytes.length === 0 || bytes.length > REFERENCE_IMAGE_MAX_BYTES) {
    throw new Error('Google Flow reference image must be nonempty and within the upload size limit.');
  }
  // Reject partial/ambiguous encodings accepted by Buffer's permissive decoder.
  if (bytes.toString('base64').replace(/=+$/, '') !== reference.base64.replace(/=+$/, '')
    || (reference.base64.includes('=') && reference.base64 !== bytes.toString('base64'))) {
    throw new Error('Google Flow reference image is not valid base64 data.');
  }
  const checksum = createHash('sha256').update(bytes).digest('hex');
  return { bytes, fileName: `openscene-ref-v1-${checksum}.${extension}` };
}
