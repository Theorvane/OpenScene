import { readFile, stat } from 'node:fs/promises';
import { fontCandidates } from '../shared/titleFont';
import { parseTitleFontRequest, type TitleFontData, type TitleFontRequest } from '../shared/titleTypography';
import type { ApiResponse } from '../shared/models';
import { fail, ok } from './ipcResponses';

/** Only allowlisted system font bytes cross the bridge. Paths and directory access stay here. */
export async function readTitleFontFile(request: TitleFontRequest): Promise<{ readonly path: string; readonly bytes: Uint8Array } | null> {
  for (const path of fontCandidates(process.platform, request.weight, request.family)) {
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > 16 * 1024 * 1024) continue;
      return { path, bytes: await readFile(path) };
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
