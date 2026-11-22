import { describe, expect, it } from 'vitest';
import { createCanvasTemplate } from '../src/shared/canvasTemplates';
import { applyEditorOperations } from '../src/shared/editorOperations';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS, type TimelineDocument } from '../src/shared/timelineTypes';
import { EMPTY_CANVAS_GRAPH, type VideoCanvasGraph } from '../src/shared/videoCanvasGraph';

function source(kind: 'video' | 'audio' = 'video', earlyStart = 0): TimelineDocument {
  return { ...createInitialTimeline(), tracks: ['late', 'early'].map((id, index) => ({
    id: `track-${id}`, name: id,
    ...(kind === 'audio' ? { kind: 'audio' as const, mix: { ...DEFAULT_AUDIO_TRACK_MIX } } : { kind: 'video' as const }),
    clips: [{ id, assetId: id, timelineStartMs: index === 0 ? 20000 : earlyStart,
      sourceStartMs: 0, sourceEndMs: 12000, sourceDurationMs: 12000,
      effects: { ...DEFAULT_CLIP_EFFECTS }, keyframes: [] }]
  })) };
}
function inputs(graph: VideoCanvasGraph, kind: string): string[] {
  const block = graph.blocks.find(block => block.kind === kind)!;
  return graph.connections.filter(edge => edge.toId === block.id).sort((a, b) => a.input - b.input).map(edge => edge.fromId);
}

describe('Canvas quick-start source ordering', () => {
  it.each([undefined, []])('automatically joins video by timeline time with selection %s', selected => {
    const timeline = source(), before = JSON.stringify(timeline);
    const result = createCanvasTemplate(timeline, EMPTY_CANVAS_GRAPH, 'highlight', 'flow', selected);
    expect(inputs(result.graph, 'video-sequence')).toEqual(['early', 'late']);
    expect(JSON.stringify(timeline)).toBe(before);
  });
  it('applies the first ten seconds of the earliest source through the shared agent/mobile batch', () => {
    const result = applyEditorOperations(source(), [
      { action: 'canvas.template', templateId: 'highlight', prefix: 'flow' },
      { action: 'canvas.apply', id: 'flow:3' }
    ]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const clips = result.timeline.tracks.flatMap(track => track.clips);
    expect(clips.map(clip => clip.assetId)).toEqual(['early']);
    expect(clips[0]).toMatchObject({ timelineStartMs: 0, sourceStartMs: 0, sourceEndMs: 10000 });
  });
  it('keeps an explicit nonempty selection in user order', () => {
    const result = createCanvasTemplate(source(), EMPTY_CANVAS_GRAPH, 'highlight', 'flow', ['late', 'early']);
    expect(inputs(result.graph, 'video-sequence')).toEqual(['late', 'early']);
  });
  it('retains track encounter order for equal start times', () => {
    const result = createCanvasTemplate(source('video', 20000), EMPTY_CANVAS_GRAPH, 'highlight', 'flow');
    expect(inputs(result.graph, 'video-sequence')).toEqual(['late', 'early']);
  });
  it('uses the earliest video as automatic picture-in-picture background', () => {
    const result = createCanvasTemplate(source(), EMPTY_CANVAS_GRAPH, 'picture-in-picture', 'flow');
    expect(inputs(result.graph, 'video-overlay')).toEqual(['early', 'late']);
  });
  it('orders automatic audio inputs chronologically too', () => {
    const result = createCanvasTemplate(source('audio'), EMPTY_CANVAS_GRAPH, 'audio-bed', 'flow');
    expect(inputs(result.graph, 'audio-mix')).toEqual(['early', 'late']);
  });
  it('uses original source snapshot times rather than edited timeline placements', () => {
    const original = source();
    const edited = { ...original, tracks: original.tracks.map(track => ({ ...track,
      clips: track.clips.map(clip => ({ ...clip, timelineStartMs: clip.id === 'late' ? 0 : 20000 }))
    })) };
    const result = createCanvasTemplate(edited, { ...EMPTY_CANVAS_GRAPH, sourceTimeline: original }, 'highlight', 'flow');
    expect(inputs(result.graph, 'video-sequence')).toEqual(['early', 'late']);
  });
});
