import { clipDurationMs } from './timelineClipGeometry';
import type { TimelineDocument } from './timelineTypes';

/** Connect two clips on one track and ripple that track into a continuous sequence. */
export function connectVideoClips(timeline: TimelineDocument, fromId: string, toId: string): TimelineDocument | null {
  if (fromId === toId) return null;
  const track = timeline.tracks.find((candidate) => candidate.kind === 'video' &&
    candidate.clips.some((clip) => clip.id === fromId) && candidate.clips.some((clip) => clip.id === toId));
  if (track === undefined) return null;
  const target = track.clips.find((clip) => clip.id === toId)!;
  const ordered = [...track.clips].sort((left, right) => left.timelineStartMs - right.timelineStartMs)
    .filter((clip) => clip.id !== toId);
  ordered.splice(ordered.findIndex((clip) => clip.id === fromId) + 1, 0, target);
  let cursor = 0;
  const clips = ordered.map((clip) => {
    const offsetMs = cursor - clip.timelineStartMs;
    const next = {
      ...clip, timelineStartMs: cursor,
      keyframes: clip.keyframes.map((keyframe) => ({ ...keyframe, timelineTimeMs: keyframe.timelineTimeMs + offsetMs }))
    };
    cursor += clipDurationMs(clip);
    return next;
  });
  const updated = { ...timeline, tracks: timeline.tracks.map((candidate) => candidate.id === track.id ? { ...candidate, clips } : candidate) };
  const validCuts = updated.tracks.flatMap((candidate) => {
    if (candidate.kind !== 'video') return [];
    const sorted = [...candidate.clips].sort((left, right) => left.timelineStartMs - right.timelineStartMs);
    return sorted.flatMap((clip, index) => {
      const next = sorted[index + 1];
      return next !== undefined && clip.timelineStartMs + clipDurationMs(clip) === next.timelineStartMs
        ? [{ fromClipId: clip.id, toClipId: next.id }] : [];
    });
  });
  return {
    ...updated,
    transitions: updated.transitions.filter((transition) => validCuts.some((cut) =>
      cut.fromClipId === transition.fromClipId && cut.toClipId === transition.toClipId))
  };
}
