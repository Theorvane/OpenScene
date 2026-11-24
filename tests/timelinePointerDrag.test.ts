import { describe, expect, it } from 'vitest';

import { moveClip } from '../src/shared/timelineLogic';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS, TIMELINE_SCHEMA_VERSION, type TimelineDocument } from '../src/shared/timelineTypes';
import { createTimelineHistory, pushTimelineHistory, undoTimelineHistory } from '../src/renderer/src/editor/editorTimelineHistory';
import {
  POINTER_DRAG_THRESHOLD_PX,
  computeClipDropPositionMs,
  computeTrimPositionMs,
  hasExceededDragThreshold,
  resolveTargetLane
} from '../src/renderer/src/editor/timelinePointerDrag';

function makeTimeline(): TimelineDocument {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    tracks: [
      {
        id: 'video-1',
        name: 'Video 1',
        kind: 'video',
        clips: [
          {
            id: 'clip-1',
            assetId: 'asset-1',
            timelineStartMs: 0,
            sourceStartMs: 0,
            sourceEndMs: 2000,
            sourceDurationMs: 10000,
            effects: DEFAULT_CLIP_EFFECTS,
            keyframes: []
          },
          {
            id: 'clip-2',
            assetId: 'asset-1',
            timelineStartMs: 5000,
            sourceStartMs: 0,
            sourceEndMs: 2000,
            sourceDurationMs: 10000,
            effects: DEFAULT_CLIP_EFFECTS,
            keyframes: []
          }
        ]
      },
      {
        id: 'video-2',
        name: 'Video 2',
        kind: 'video',
        clips: []
      },
      {
        id: 'audio-1',
        name: 'Audio 1',
        kind: 'audio',
        clips: [],
        mix: DEFAULT_AUDIO_TRACK_MIX
      }
    ],
    titles: [],
    transitions: []
  };
}

describe('timelinePointerDrag', () => {
  it('enforces the pointer drag threshold before entering drag state', () => {
    expect(hasExceededDragThreshold(100, 200, 102, 201)).toBe(false);
    expect(hasExceededDragThreshold(100, 200, 100 + POINTER_DRAG_THRESHOLD_PX, 200)).toBe(true);
    expect(hasExceededDragThreshold(100, 200, 103, 203)).toBe(true);
  });

  it('resolves target track lanes by clientY while respecting locked tracks', () => {
    const lanes = [
      { trackId: 'video-1', top: 500, bottom: 556, left: 180, width: 1000 },
      { trackId: 'video-2', top: 560, bottom: 616, left: 180, width: 1000 }
    ];

    expect(resolveTargetLane(lanes, 580, 'video-1', {})?.trackId).toBe('video-2');
    expect(resolveTargetLane(lanes, 580, 'video-1', { 'video-2': true })?.trackId).toBe('video-1');
    expect(resolveTargetLane(lanes, 400, 'video-1', {})?.trackId).toBe('video-1');
  });

  it('computes snapped and alt-bypassed drop and trim positions', () => {
    const timeline = makeTimeline();

    // Near clip-2's start (5000ms) with clip-1 duration 2000ms -> snaps clip-1 start to 3000ms (end hits 5000ms).
    const snapped = computeClipDropPositionMs({
      timeline,
      clipId: 'clip-1',
      clientX: 180 + 302, // ~3020ms on a 1000px / 10000ms lane
      laneLeft: 180,
      laneWidth: 1000,
      durationMs: 10000,
      offsetMs: 0,
      playheadMs: 0,
      snappingEnabled: true,
      altKey: false
    });
    expect(snapped).toBe(3000);

    // Alt bypasses snapping.
    const unsnapped = computeClipDropPositionMs({
      timeline,
      clipId: 'clip-1',
      clientX: 180 + 302,
      laneLeft: 180,
      laneWidth: 1000,
      durationMs: 10000,
      offsetMs: 0,
      playheadMs: 0,
      snappingEnabled: true,
      altKey: true
    });
    expect(unsnapped).toBe(3020);

    const trimPos = computeTrimPositionMs({
      timeline,
      clipId: 'clip-1',
      clientX: 180 + 150,
      laneLeft: 180,
      laneWidth: 1000,
      durationMs: 10000,
      playheadMs: 1490,
      snappingEnabled: true,
      altKey: false
    });
    expect(trimPos).toBe(1490);
  });

  it('commits a single pointer clip drag as exactly 1 Undo step and rejects overlaps cleanly', () => {
    const initial = makeTimeline();
    const history0 = createTimelineHistory(initial);

    // Valid move on pointerup (clip-1 from 0ms -> 2500ms)
    const moved = moveClip(initial, { clipId: 'clip-1', targetTrackId: 'video-1', timelineStartMs: 2500 });
    expect(moved).not.toBeNull();
    expect(moved!.tracks[0]!.clips[0]!.timelineStartMs).toBe(2500);

    const history1 = pushTimelineHistory(history0, moved!);
    expect(history1.past).toHaveLength(1);

    // Overlapping move is rejected (returns null), leaving history untouched.
    const overlapped = moveClip(moved!, { clipId: 'clip-1', targetTrackId: 'video-1', timelineStartMs: 4500 });
    expect(overlapped).toBeNull();

    // 1 Undo step restores exact original start (0ms).
    const undone = undoTimelineHistory(history1);
    expect(undone).not.toBeNull();
    expect(undone!.past).toHaveLength(0);
    expect(undone!.present.tracks[0]!.clips[0]!.timelineStartMs).toBe(0);
  });
});
