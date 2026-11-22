import { runFfprobe } from './ffprobeRunner';

import {
  personalMetadataFieldsForKeys,
  type MetadataTagInventory
} from '../shared/metadataPrivacy';
import { ffprobePathFor } from './exportMeasurement';

export type InspectContainerMetadataInput = {
  readonly ffmpegPath: string;
  readonly filePath: string;
};

export function containerMetadataProbeArgs(filePath: string): readonly string[] {
  return [
    '-v',
    'error',
    '-show_entries',
    'format_tags:stream_tags',
    '-of',
    'json',
    filePath
  ];
}

function tagKeys(value: unknown): readonly string[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const tags = (value as { tags?: unknown }).tags;
  if (tags === undefined) return [];
  return typeof tags === 'object' && tags !== null && !Array.isArray(tags) ? Object.keys(tags) : null;
}

/** Parses names only and immediately discards every tag value returned by FFprobe. */
export function parseContainerMetadataProbeOutput(stdout: string): MetadataTagInventory | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as { format?: unknown; streams?: unknown };
  const hasFormat = typeof record.format === 'object' && record.format !== null && !Array.isArray(record.format);
  const hasStreams = Array.isArray(record.streams);
  if (!hasFormat && !hasStreams) return null;
  if (record.format !== undefined && !hasFormat) return null;
  if (record.streams !== undefined && !hasStreams) return null;
  const formatKeys = hasFormat ? tagKeys(record.format) : [];
  const streamKeys = hasStreams
    ? (record.streams as readonly unknown[]).map(tagKeys)
    : [];
  if (formatKeys === null || streamKeys.some((keys) => keys === null)) return null;
  const keys = [
    ...formatKeys,
    ...streamKeys.flatMap((entry) => entry ?? [])
  ];
  return { checked: true, fields: personalMetadataFieldsForKeys(keys) };
}

/** Null raw results become an unchecked, path-free inventory. */
export async function inspectContainerMetadata(input: InspectContainerMetadataInput): Promise<MetadataTagInventory> {
  const result = await runFfprobe({ executablePath: ffprobePathFor(input.ffmpegPath), filePath: input.filePath, args: containerMetadataProbeArgs(input.filePath) });
  return result === null ? { checked: false, fields: [] } : parseContainerMetadataProbeOutput(result.stdout) ?? { checked: false, fields: [] };
}
