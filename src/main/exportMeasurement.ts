import { runFfprobe } from './ffprobeRunner';
import type { ExportMeasurement } from '../shared/exportReview';

/**
 * Measuring a finished export with the FFmpeg toolchain already discovered.
 *
 * FFprobe, not FFmpeg: the question is what the file is, and `ffprobe -of json`
 * answers it in one call instead of leaving a banner to be parsed. It ships
 * beside FFmpeg in every distribution of it, so it is looked for there — and a
 * machine that turns out not to have one leaves the export unchecked rather
 * than failing it, because being unable to inspect a file says nothing about
 * the file.
 */

/** `ffmpeg` and `ffprobe` live in the same directory and share an extension. */
export function ffprobePathFor(ffmpegPath: string): string {
  // Do not parse this with the host OS path implementation: project tests and
  // recovered job records can legitimately contain a path written on another
  // platform. Both separators are unambiguous here because only the final
  // executable name is replaced.
  const separatorIndex = Math.max(ffmpegPath.lastIndexOf('/'), ffmpegPath.lastIndexOf('\\'));
  const directory = ffmpegPath.slice(0, separatorIndex + 1);
  const name = ffmpegPath.slice(separatorIndex + 1);
  const probeName = name.replace(/ffmpeg/i, (matched) => (matched === matched.toUpperCase() ? 'FFPROBE' : 'ffprobe'));
  // A path whose file name says nothing about ffmpeg is not one to rewrite by
  // guessing; the sibling is the only place worth looking.
  return `${directory}${probeName === name ? 'ffprobe' : probeName}`;
}

export function ffprobeArgs(filePath: string): readonly string[] {
  return [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,width,height,avg_frame_rate:stream_side_data=rotation:stream_tags=rotate:format=duration',
    '-of',
    'json',
    filePath
  ];
}

type ProbeStream = {
  readonly codec_type?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly avg_frame_rate?: unknown;
  readonly tags?: { readonly rotate?: unknown };
  readonly side_data_list?: readonly { readonly rotation?: unknown }[];
};

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** FFprobe writes a frame rate as a ratio, and writes `0/0` when it has none. */
function frameRateOf(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const [numerator, denominator] = value.split('/');
  const top = Number(numerator);
  const bottom = denominator === undefined ? 1 : Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0 || top <= 0) return undefined;
  return top / bottom;
}

/**
 * Turn FFprobe's JSON into a measurement, or null when it does not describe a
 * video file. Separated from running the process so the parsing is testable
 * without one.
 */
export function parseFfprobeOutput(stdout: string): ExportMeasurement | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const streams = (parsed as { streams?: unknown }).streams;
  const format = (parsed as { format?: unknown }).format;
  if (!Array.isArray(streams)) return null;

  const video = (streams as ProbeStream[]).find((stream) => stream.codec_type === 'video');
  const hasSoundTrack = (streams as ProbeStream[]).some((stream) => stream.codec_type === 'audio');
  const durationSeconds = Number(
    typeof format === 'object' && format !== null ? (format as { duration?: unknown }).duration : Number.NaN
  );

  if (video === undefined) {
    // No picture at all is a measurement, not a failure to measure: the review
    // has something to say about it and should be allowed to say it.
    return { widthPx: 0, heightPx: 0, durationMs: 0, hasSoundTrack };
  }

  const width = positiveInteger(video.width);
  const height = positiveInteger(video.height);
  // FFmpeg autorotates input before timeline filters. Measure displayed geometry,
  // otherwise a portrait recipe can crop a phone clip whose coded axes are swapped.
  const rotation = Number(video.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0);
  if (!Number.isFinite(rotation) || rotation % 90 !== 0) return null;
  const swapped = Math.abs(rotation % 180) === 90;
  const frameRate = frameRateOf(video.avg_frame_rate);

  return {
    widthPx: (swapped ? height : width) ?? 0,
    heightPx: (swapped ? width : height) ?? 0,
    durationMs: Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1_000) : 0,
    hasSoundTrack,
    ...(frameRate === undefined ? {} : { frameRate })
  };
}

export type MeasureExportInput = {
  readonly ffmpegPath: string;
  readonly filePath: string;
};

/** Null means "not measured" — never "measured and fine". */
export async function measureExportedFile(input: MeasureExportInput): Promise<ExportMeasurement | null> {
  const result = await runFfprobe({ executablePath: ffprobePathFor(input.ffmpegPath), filePath: input.filePath, args: ffprobeArgs(input.filePath) });
  if (result === null) return null;
  const measurement = parseFfprobeOutput(result.stdout);
  return measurement === null ? null : { ...measurement, verificationRuntime: result.runtime };
}
