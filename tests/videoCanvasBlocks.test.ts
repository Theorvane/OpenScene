import { describe, expect, it } from 'vitest';
import { applyCanvasBlock, evaluateCanvasBlock } from '../src/shared/videoCanvasBlocks';
import { connectCanvasInput, parseVideoCanvasGraph, type CanvasBlockKind, type VideoCanvasGraph } from '../src/shared/videoCanvasGraph';
import { parseTimelineDocument } from '../src/shared/timelineDocumentValidators';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS, type PersistedTimelineClip, type TimelineDocument } from '../src/shared/timelineTypes';

function clip(id: string, start = 0, speed = 1): PersistedTimelineClip {
  return { id, assetId: id, timelineStartMs: start, sourceStartMs: 1000, sourceEndMs: 3000, sourceDurationMs: 6000,
    effects: { ...DEFAULT_CLIP_EFFECTS, speed },
    keyframes: [{ timelineTimeMs: start + 100, property: 'opacity', value: 0.5, interpolation: 'linear' }] };
}
function timeline(): TimelineDocument {
  return { ...createInitialTimeline(), tracks: [
    { id: 'v', name: 'Video', kind: 'video', clips: [clip('v1', 3000), clip('v2', 6000, 2), clip('untouched', 10000)] },
    { id: 'a', name: 'Voice', kind: 'audio', clips: [clip('a1', 5000)], mix: { ...DEFAULT_AUDIO_TRACK_MIX, gainDb: -6, pan: -0.5 } },
    { id: 'b', name: 'Music', kind: 'audio', clips: [clip('a2', 9000)], mix: { ...DEFAULT_AUDIO_TRACK_MIX, pan: 0.5 } }
  ] };
}
function graph(kind: CanvasBlockKind, sources: string[]): VideoCanvasGraph {
  return { blocks: [{ id: 'block', kind, inputCount: 2, position: { x: 200, y: 200 } }],
    connections: sources.map((fromId, input) => ({ fromId, toId: 'block', input })) };
}
function applied(kind: CanvasBlockKind, sources: string[]) {
  const result = applyCanvasBlock(timeline(), graph(kind, sources), 'block');
  if (!result.success) throw new Error(result.error);
  return result.timeline;
}

describe('functional video canvas blocks', () => {
  it('joins videos using playback duration and moves keyframes without altering unrelated clips', () => {
    const next = applied('video-sequence', ['v2', 'v1']);
    const joined = next.tracks.find(track => track.clips.some(item => item.id === 'v2'))!;
    expect(joined.clips.map(item => [item.id, item.timelineStartMs])).toEqual([['v2', 0], ['v1', 1000]]);
    expect(joined.clips.map(item => item.keyframes[0]?.timelineTimeMs)).toEqual([100, 1100]);
    expect(joined.clips.map(item => [item.sourceStartMs, item.sourceEndMs])).toEqual([[1000, 3000], [1000, 3000]]);
    expect(next.tracks[0]!.clips).toEqual([clip('untouched', 10000)]);
    expect(timeline().tracks[0]!.clips).toHaveLength(3);
  });

  it.each(['audio-sequence', 'audio-mix'] as const)('%s retains per-track mix and uses sequential or simultaneous starts', kind => {
    const next = applied(kind, ['a1', 'a2']);
    const audio = next.tracks.filter(track => track.kind === 'audio');
    expect(audio.map(track => track.clips[0]?.timelineStartMs)).toEqual([0, kind === 'audio-sequence' ? 2000 : 0]);
    expect(audio.map(track => track.mix.pan)).toEqual([-0.5, 0.5]);
    expect(audio[0]!.mix.gainDb).toBe(-6);
  });

  it('chains video and audio joins into an AV output and persists the graph through the timeline codec', () => {
    const video = graph('video-sequence', ['v1', 'v2']);
    const audio = graph('audio-sequence', ['a1', 'a2']);
    const flow: VideoCanvasGraph = {
      blocks: [video.blocks[0]!, { ...audio.blocks[0]!, id: 'audio' }, { id: 'av', kind: 'video-audio', inputCount: 2, position: { x: 600, y: 200 } }],
      connections: [...video.connections, ...audio.connections.map(edge => ({ ...edge, toId: 'audio' })), { fromId: 'block', toId: 'av', input: 0 }, { fromId: 'audio', toId: 'av', input: 1 }]
    };
    const result = applyCanvasBlock(timeline(), flow, 'av');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(parseTimelineDocument(JSON.parse(JSON.stringify(result.timeline)))?.canvas).toEqual(flow);
    const output = evaluateCanvasBlock(result.timeline, flow, 'av');
    expect(output.success && output.output.durationMs).toBe(4000);
    expect(output.success && output.output.type).toBe('video-audio');
    expect(applyCanvasBlock(result.timeline, flow, 'av')).toEqual(result);
  });

  it('rejects duplicate source use, missing inputs, incompatible types and cycles', () => {
    expect(evaluateCanvasBlock(timeline(), graph('video-sequence', ['v1', 'v1']), 'block').success).toBe(false);
    expect(evaluateCanvasBlock(timeline(), graph('video-sequence', ['v1']), 'block').success).toBe(false);
    expect(evaluateCanvasBlock(timeline(), graph('video-sequence', ['v1', 'deleted']), 'block').success).toBe(false);
    expect(connectCanvasInput(timeline(), graph('video-sequence', []), { fromId: 'a1', toId: 'block', input: 0 }).success).toBe(false);
    const flow: VideoCanvasGraph = { blocks: [graph('video-sequence', []).blocks[0]!, { ...graph('video-sequence', []).blocks[0]!, id: 'second' }], connections: [{ fromId: 'block', toId: 'second', input: 0 }] };
    expect(connectCanvasInput(timeline(), flow, { fromId: 'second', toId: 'block', input: 0 }).success).toBe(false);
    expect(evaluateCanvasBlock(timeline(), { ...flow, connections: [...flow.connections, { fromId: 'second', toId: 'block', input: 0 }] }, 'block').success).toBe(false);
  });

  it('replaces a connected input and enforces persisted graph limits without changing old documents', () => {
    const flow = graph('video-sequence', ['v1', 'v2']);
    const result = connectCanvasInput(timeline(), flow, { fromId: 'untouched', toId: 'block', input: 1 });
    expect(result.success && result.graph.connections).toHaveLength(2);
    expect(parseTimelineDocument(timeline())?.canvas).toBeUndefined();
    expect(parseVideoCanvasGraph({ ...flow, blocks: [{ ...flow.blocks[0], inputCount: 9 }] })).toBeNull();
    expect(parseVideoCanvasGraph({ ...flow, connections: [...flow.connections, flow.connections[0]] })).toBeNull();
    expect(parseTimelineDocument({ ...timeline(), canvas: { ...flow, blocks: [{ ...flow.blocks[0], id: 'v1' }] } })).toBeNull();
  });
});
