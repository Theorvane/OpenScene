import { open, stat } from 'node:fs/promises';
import { z } from 'zod';
import { runReaProcess } from './reaVideoAnalysisProcess';
import { ffprobePathFor } from './exportMeasurement';

const probeSchema = z.object({ streams: z.array(z.object({ codec_type: z.string(), width: z.number().int().optional(), height: z.number().int().optional() })).max(4),
  format: z.object({ duration: z.string(), format_name: z.string() }) });
export interface VerifiedGenerationMedia { readonly durationMs: number; readonly width: number; readonly height: number; readonly byteLength: number }
export async function verifyGenerationMedia(ffmpeg: string, path: string, expectedDurationMs: number, signal: AbortSignal): Promise<VerifiedGenerationMedia> {
  const file = await open(path, 'r');
  try {
    const head = Buffer.alloc(12); await file.read(head, 0, 12, 0);
    if (head.subarray(4, 8).toString() !== 'ftyp') throw new Error('RESULT_CONTAINER_REJECTED');
  } finally { await file.close(); }
  const bytes = (await stat(path)).size;
  if (bytes < 32 || bytes > 100_000_000) throw new Error('RESULT_SIZE_REJECTED');
  const probe = await runReaProcess(ffprobePathFor(ffmpeg), ['-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file', '-format_whitelist', 'mov',
    '-show_entries', 'format=duration,format_name:stream=codec_type,width,height', '-of', 'json', path], signal, 15000);
  const p = probeSchema.parse(JSON.parse(probe.stdout)), video = p.streams.filter(s => s.codec_type === 'video');
  const v = video[0], durationMs = Math.round(Number(p.format.duration) * 1000);
  if (!v?.width || !v.height || video.length !== 1 || p.streams.some(s => s.codec_type !== 'video')
    || !p.format.format_name.split(',').includes('mp4') || !Number.isSafeInteger(durationMs)
    || Math.abs(durationMs - expectedDurationMs) > 300 || Math.min(v.width, v.height) !== 768 || Math.max(v.width, v.height) > 2048) throw new Error('RESULT_MEDIA_REJECTED');
  // Probe metadata alone cannot prove an intact video: decode the full bounded clip.
  await runReaProcess(ffmpeg, ['-nostdin', '-hide_banner', '-v', 'error', '-xerror', '-err_detect', 'explode', '-max_alloc', '67108864',
    '-threads', '1', '-protocol_whitelist', 'file', '-format_whitelist', 'mov', '-i', path, '-map', '0:v:0', '-an', '-sn', '-dn', '-f', 'null', '-'], signal, 30000);
  return { durationMs, width: v.width, height: v.height, byteLength: bytes };
}

export async function assembleGenerationReview(ffmpeg: string, input: string, output: string, targetDurationMs: number, signal: AbortSignal): Promise<VerifiedGenerationMedia> {
  if (!Number.isSafeInteger(targetDurationMs) || targetDurationMs < 1000 || targetDurationMs > 15000 || input === output) throw new Error('ASSEMBLY_REJECTED');
  await runReaProcess(ffmpeg, ['-nostdin', '-hide_banner', '-v', 'error', '-n', '-max_alloc', '67108864', '-threads', '1', '-filter_threads', '1',
    '-protocol_whitelist', 'file', '-format_whitelist', 'mov', '-i', input, '-map', '0:v:0', '-an', '-sn', '-dn', '-t', String(targetDurationMs / 1000),
    '-vf', 'scale=1366:768:force_original_aspect_ratio=decrease,pad=1366:768:(ow-iw)/2:(oh-ih)/2,setsar=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], signal, 60000);
  return verifyGenerationMedia(ffmpeg, output, targetDurationMs, signal);
}
