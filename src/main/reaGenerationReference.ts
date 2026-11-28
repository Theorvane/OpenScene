import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AssetLibraryStore } from './assetLibraryStore';
import { runReaProcess } from './reaVideoAnalysisProcess';
import { ffprobePathFor } from './exportMeasurement';
import type { ReaGenerationPlan } from '../shared/reaGeneration';

export async function resolveGenerationReference(assets: Pick<AssetLibraryStore, 'openPlaybackSource'>, directory: string,
  ffmpeg: string, projectId: string, assetId: string): Promise<{ reference: NonNullable<ReaGenerationPlan['referenceImage']>; bytes: Uint8Array }> {
  const source = await assets.openPlaybackSource(projectId, assetId);
  if (!source) throw new Error('REFERENCE_UNAVAILABLE');
  let temporary: string | undefined;
  try {
    if (!['image/png', 'image/jpeg'].includes(source.mimeType) || source.byteLength > 5_000_000 || source.byteLength < 16) throw new Error('REFERENCE_REJECTED');
    const buffer = Buffer.alloc(source.byteLength + 1); let length = 0;
    while (length < buffer.length) { const read = await source.file.read(buffer, length, buffer.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    if (length !== source.byteLength || (await source.file.stat()).size !== source.byteLength) throw new Error('REFERENCE_CHANGED');
    const bytes = buffer.subarray(0, length);
    const png = source.mimeType === 'image/png';
    if (png ? bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' : bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new Error('REFERENCE_FORMAT_REJECTED');
    await mkdir(directory, { recursive: true, mode: 0o700 }); temporary = await mkdtemp(join(directory, 'image-'));
    const path = join(temporary, png ? 'first.png' : 'first.jpg'); await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    const probe = await runReaProcess(ffprobePathFor(ffmpeg), ['-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file',
      '-show_entries', 'stream=codec_type,width,height', '-of', 'json', path], new AbortController().signal, 10000);
    const parsed = z.object({ streams: z.array(z.object({ codec_type: z.literal('video'), width: z.number().int().min(256).max(5760), height: z.number().int().min(256).max(5760) })).length(1) }).parse(JSON.parse(probe.stdout));
    const image = parsed.streams[0]!;
    if (image.width / image.height < 0.4 || image.width / image.height > 2.5) throw new Error('REFERENCE_DIMENSIONS_REJECTED');
    await runReaProcess(ffmpeg, ['-nostdin', '-hide_banner', '-v', 'error', '-xerror', '-err_detect', 'explode', '-max_alloc', '67108864',
      '-threads', '1', '-protocol_whitelist', 'file', '-i', path, '-frames:v', '1', '-f', 'null', '-'], new AbortController().signal, 10000);
    return { reference: { assetId, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength, mimeType: png ? 'image/png' : 'image/jpeg' }, bytes };
  } catch { throw new Error('REFERENCE_UNAVAILABLE'); }
  finally { await source.file.close(); if (temporary) await rm(temporary, { force: true, recursive: true }); }
}
