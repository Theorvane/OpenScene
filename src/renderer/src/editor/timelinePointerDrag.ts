import { clipDurationMs } from '../../../shared/timelineClipGeometry';
import { snapTimelinePosition } from '../../../shared/timelineSnapping';
import type { TimelineDocument } from '../../../shared/timelineTypes';
import { clientXToTimelineMs } from './editorTimelineView';

export const POINTER_DRAG_THRESHOLD_PX = 4;

export interface LaneBounds {
  readonly trackId: string;
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
}

export interface ClipPointerDragSession {
  readonly kind: 'clip';
  readonly pointerId: number;
  readonly clipId: string;
  readonly sourceTrackId: string;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly offsetMs: number;
  readonly originalStartMs: number;
  readonly moved: boolean;
}

export interface TrimPointerDragSession {
  readonly kind: 'trim';
  readonly pointerId: number;
  readonly clipId: string;
  readonly trackId: string;
  readonly edge: 'left' | 'right';
  readonly startClientX: number;
  readonly startClientY: number;
  readonly moved: boolean;
}

export type TimelinePointerDragSession = ClipPointerDragSession | TrimPointerDragSession;

export interface ClipDragPreview {
  readonly kind: 'clip';
  readonly clipId: string;
  readonly targetTrackId: string;
  readonly previewStartMs: number;
  readonly deltaMs: number;
}

export interface TrimDragPreview {
  readonly kind: 'trim';
  readonly clipId: string;
  readonly trackId: string;
  readonly edge: 'left' | 'right';
  readonly previewTimeMs: number;
}

export type TimelineDragPreview = ClipDragPreview | TrimDragPreview;

export function hasExceededDragThreshold(startX: number, startY: number, currentX: number, currentY: number): boolean {
  return Math.hypot(currentX - startX, currentY - startY) >= POINTER_DRAG_THRESHOLD_PX;
}

export function resolveTargetLane(
  lanes: readonly LaneBounds[],
  clientY: number,
  fallbackTrackId: string,
  lockedTracks: Readonly<Record<string, boolean>>
): LaneBounds | null {
  const hit = lanes.find((lane) => clientY >= lane.top && clientY <= lane.bottom && !lockedTracks[lane.trackId]);
  if (hit !== undefined) return hit;
  const fallback = lanes.find((lane) => lane.trackId === fallbackTrackId && !lockedTracks[lane.trackId]);
  return fallback ?? null;
}

export function computeClipDropPositionMs(input: {
  readonly timeline: TimelineDocument;
  readonly clipId: string;
  readonly clientX: number;
  readonly laneLeft: number;
  readonly laneWidth: number;
  readonly durationMs: number;
  readonly offsetMs: number;
  readonly playheadMs: number;
  readonly snappingEnabled: boolean;
  readonly altKey: boolean;
  readonly snapMs?: number;
}): number {
  const atMs = clientXToTimelineMs({
    clientX: input.clientX,
    laneLeft: input.laneLeft,
    laneWidth: input.laneWidth,
    durationMs: input.durationMs,
    snapMs: input.snapMs ?? 1
  });
  const clip = input.timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === input.clipId);
  const rawStartMs = Math.max(0, atMs - input.offsetMs);
  return Math.max(
    0,
    snapTimelinePosition({
      timeline: input.timeline,
      positionMs: rawStartMs,
      pixelsPerMs: input.laneWidth / Math.max(1, input.durationMs),
      playheadMs: input.playheadMs,
      enabled: input.snappingEnabled && !input.altKey,
      ...(clip === undefined ? {} : { excludeClipId: clip.id, movingDurationMs: clipDurationMs(clip) })
    })
  );
}

export function computeTrimPositionMs(input: {
  readonly timeline: TimelineDocument;
  readonly clipId: string;
  readonly clientX: number;
  readonly laneLeft: number;
  readonly laneWidth: number;
  readonly durationMs: number;
  readonly playheadMs: number;
  readonly snappingEnabled: boolean;
  readonly altKey: boolean;
  readonly snapMs?: number;
}): number {
  const atMs = clientXToTimelineMs({
    clientX: input.clientX,
    laneLeft: input.laneLeft,
    laneWidth: input.laneWidth,
    durationMs: input.durationMs,
    snapMs: input.snapMs ?? 1
  });
  const clip = input.timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === input.clipId);
  return Math.max(
    0,
    snapTimelinePosition({
      timeline: input.timeline,
      positionMs: atMs,
      pixelsPerMs: input.laneWidth / Math.max(1, input.durationMs),
      playheadMs: input.playheadMs,
      enabled: input.snappingEnabled && !input.altKey,
      ...(clip === undefined ? {} : { excludeClipId: clip.id })
    })
  );
}
