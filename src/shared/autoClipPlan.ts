import type { MediaAsset, TimelineDocument } from './timelineTypes';
import { applyEditorOperations } from './editorOperations';

/** AutoClip start_time/end_time are source seconds, never timeline milliseconds. */
export function planAutoClipEdit(timeline: TimelineDocument, assets: readonly MediaAsset[], input: {
  assetId: string; prefix: string; segments: readonly { start_time: number; end_time: number }[];
}) {
  const asset = assets.find(item => item.id === input.assetId);
  if (!asset || (asset.kind !== 'video' && asset.kind !== 'audio')) return { success: false as const, error: 'Choose an imported video or audio asset.' };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(input.prefix) || input.segments.length < 1 || input.segments.length > 32) {
    return { success: false as const, error: 'Use a unique opaque prefix and 1–32 segments.' };
  }
  const trackId = `${input.prefix}:track`;
  if (timeline.tracks.some(track => track.id === trackId)) return { success: false as const, error: 'Choose a new prefix; the destination track already exists.' };
  const operations: Record<string, unknown>[] = [{ action: 'track.add', id: trackId, kind: asset.kind, name: 'AutoClip highlights' }];
  let cursor = 0;
  for (const [index, segment] of input.segments.entries()) {
    const start = Math.round(segment.start_time * 1000), end = Math.round(segment.end_time * 1000);
    if (!Number.isFinite(segment.start_time) || !Number.isFinite(segment.end_time) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
      return { success: false as const, error: 'Each segment needs finite source seconds with end_time greater than start_time.' };
    }
    operations.push({ action: 'clip.add', id: `${input.prefix}:clip:${index}`, assetId: asset.id, trackId, startMs: cursor, sourceStartMs: start, sourceEndMs: end });
    cursor += end - start;
  }
  const validated = applyEditorOperations(timeline, operations, assets);
  if (!validated.success) return validated;
  return { success: true as const, operations, durationMs: cursor, segmentCount: input.segments.length, requiresApproval: true as const };
}
