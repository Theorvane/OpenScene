import { open } from 'node:fs/promises';
import { fontCandidates } from '../shared/titleFont';
import { parseTitleFontRequest, type TitleFontData, type TitleFontRequest } from '../shared/titleTypography';
import type { ApiResponse } from '../shared/models';
import { fail, ok } from './ipcResponses';

/** Only allowlisted system font bytes cross the bridge. Paths and directory access stay here. */
export async function readTitleFontFile(request: TitleFontRequest): Promise<{ readonly path: string; readonly bytes: Uint8Array } | null> {
  for (const path of fontCandidates(process.platform, request.weight, request.family)) {
    try {
      const file = await open(path, 'r');
      try {
        const info = await file.stat();
        // System CJK collections include many faces (Apple SD Gothic Neo is ~53 MiB).
        // Keep ordinary faces at 16 MiB and allowlisted collections at 64 MiB.
        const limit = (path.endsWith('.ttc') ? 64 : 16) * 1024 * 1024;
        if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size <= 0 || info.size > limit) continue;
        // Read the same handle we statted, with one sentinel byte to reject growth.
        // Unlike readFile, this cannot allocate without bound if a file changes.
        const bytes = Buffer.alloc(info.size + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, null);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        if (offset !== info.size) continue;
        return { path, bytes: bytes.subarray(0, offset) };
      } finally {
        await file.close();
      }
    } catch { /* Try the next allowlisted face. */ }
  }
  return null;
}
export async function readTitleFontData(input: unknown): Promise<ApiResponse<TitleFontData>> {
  const request = parseTitleFontRequest(input);
  if (!request) return fail('INVALID_INPUT', 'Choose a supported title font and weight.');
  const file = await readTitleFontFile(request);
  return file ? ok({ ...request, base64: Buffer.from(file.bytes).toString('base64') })
    : fail('FONT_UNAVAILABLE', 'The selected system font is unavailable on this machine. Choose another family.');
}
