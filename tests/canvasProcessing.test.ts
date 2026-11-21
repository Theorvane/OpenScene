import { describe, expect, it } from 'vitest';
import { applyEditorOperations } from '../src/shared/editorOperations';
import { evaluateCanvasBlock } from '../src/shared/videoCanvasBlocks';
import { canvasOutputType, parseVideoCanvasGraph, type CanvasBlockKind } from '../src/shared/videoCanvasGraph';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS, type PersistedTimelineClip, type TimelineDocument } from '../src/shared/timelineTypes';

const clip = (id: string, start: number, duration: number): PersistedTimelineClip => ({ id, assetId: id, timelineStartMs: start, sourceStartMs: 0, sourceEndMs: duration, sourceDurationMs: duration, effects: { ...DEFAULT_CLIP_EFFECTS }, keyframes: [] });
function source(): TimelineDocument {
  return { ...createInitialTimeline(), tracks: [
    { id: 'v', name: 'Video', kind: 'video', clips: [{ ...clip('v1', 3000, 6000), keyframes: [{ timelineTimeMs: 4500, property: 'opacity', value: 0.8, interpolation: 'linear' }] }, clip('v2', 10000, 4000)] },
    { id: 'a', name: 'Voice', kind: 'audio', clips: [clip('a1', 8000, 4000)], mix: { ...DEFAULT_AUDIO_TRACK_MIX } }
  ] };
}
function run(timeline: TimelineDocument, operations: readonly unknown[]) {
  const result = applyEditorOperations(timeline, operations);
  if (!result.success) throw new Error(result.error);
  return result.timeline;
}
const add = (id: string, kind: CanvasBlockKind, settings?: Record<string, unknown>) => ({ action: 'canvas.add', id, kind, ...(settings ? { settings } : {}) });
const connect = (fromId: string, toId: string, input = 0) => ({ action: 'canvas.connect', fromId, toId, input });

describe('processing canvas blocks', () => {
  it('removes whole source clips excluded by a downstream trim, preserving unrelated media', () => {
    const next = run(source(), [add('join', 'video-sequence'), connect('v1', 'join'), connect('v2', 'join', 1), add('cut', 'trim', { startMs: 0, endMs: 1000 }), connect('join', 'cut'), { action: 'canvas.apply', id: 'cut' }]);
    expect(next.tracks.filter(track => track.kind === 'video').flatMap(track => track.clips).map(clip => [clip.id, clip.sourceEndMs])).toEqual([['v1', 1000]]);
    expect(next.tracks.find(track => track.id === 'a')?.clips[0]?.id).toBe('a1');
    expect(run(next, [{ action: 'canvas.apply', id: 'cut' }])).toEqual(next);
    expect(next.canvas?.sourceTimeline?.tracks[0]?.clips.map(clip => clip.id)).toEqual(['v1', 'v2']);
  });
  it('trims, retimes and delays keyframes, while repeated apply preserves original inputs', () => {
    const original = source();
    const next = run(original, [add('trim', 'trim', { startMs: 1000, endMs: 3000 }), connect('v1', 'trim'), add('speed', 'speed', { rate: 2 }), connect('trim', 'speed'), add('delay', 'delay', { delayMs: 500 }), connect('speed', 'delay'), { action: 'canvas.apply', id: 'delay' }]);
    const output = next.tracks.flatMap(track => track.clips).find(clip => clip.id === 'v1')!;
    expect([output.sourceStartMs, output.sourceEndMs, output.timelineStartMs, output.effects.speed]).toEqual([1000, 3000, 500, 2]);
    expect(output.keyframes[0]?.timelineTimeMs).toBe(750);
    expect(next.canvas?.sourceTimeline?.tracks[0]?.clips[0]?.sourceStartMs).toBe(0);
    expect(run(next, [{ action: 'canvas.apply', id: 'delay' }])).toEqual(next);
    expect(original.tracks[0]!.clips[0]!.sourceStartMs).toBe(0);
    expect(parseVideoCanvasGraph(JSON.parse(JSON.stringify(next.canvas)))).toEqual(next.canvas);
  });
  it('lets AV branches continue through processing blocks without losing their sound', () => {
    const next = run(source(), [add('mute', 'video-mute'), connect('v1', 'mute'), add('vol', 'volume', { volume: 0.25 }), connect('a1', 'vol'), add('av', 'video-audio'), connect('mute', 'av'), connect('vol', 'av', 1), add('look', 'look', { preset: 'monochrome' }), connect('av', 'look'), add('speed', 'speed', { rate: 2 }), connect('look', 'speed'), { action: 'canvas.apply', id: 'speed' }]);
    expect(canvasOutputType(next, next.canvas!, 'speed')).toBe('video-audio');
    const video = next.tracks.flatMap(track => track.clips).find(clip => clip.id === 'v1')!;
    const audio = next.tracks.flatMap(track => track.clips).find(clip => clip.id === 'a1')!;
    expect(video.effects).toMatchObject({ volume: 0, saturation: 0, speed: 2 });
    expect(audio.effects).toMatchObject({ volume: 0.25, speed: 2 });
  });
  it('puts the inset above the background and applies picture transforms', () => {
    const next = run(source(), [add('pip', 'video-overlay', { scale: 0.4, positionX: 150, opacity: 0.8 }), connect('v1', 'pip'), connect('v2', 'pip', 1), { action: 'canvas.apply', id: 'pip' }]);
    const videos = next.tracks.filter(track => track.kind === 'video');
    expect(videos[0]!.clips[0]!.id).toBe('v2');
    expect(videos[0]!.clips[0]!.effects).toMatchObject({ scale: 0.4, positionX: 150, opacity: 0.8 });
    expect(videos[1]!.clips[0]!.id).toBe('v1');
    const transformed = run(next, [add('move', 'transform', { scale: 0.75, positionY: -50 }), connect('pip', 'move'), { action: 'canvas.apply', id: 'move' }]);
    expect(transformed.tracks.find(track => track.kind === 'video')!.clips[0]!.effects).toMatchObject({ scale: 0.75, positionY: -50 });
  });
  it('builds ready-made connections and caps highlights at ten seconds', () => {
    const timeline = source();
    for (const [templateId, sourceIds] of [['highlight', ['v1', 'v2']], ['video-music', ['v1', 'a1']], ['picture-in-picture', ['v1', 'v2']], ['audio-bed', ['a1']]] as const) {
      const result = applyEditorOperations(timeline, [{ action: 'canvas.template', templateId, prefix: 'quick', sourceIds: [...sourceIds] }]);
      expect(result.success).toBe(true);
      if (!result.success) continue;
      const output = evaluateCanvasBlock(result.timeline, result.timeline.canvas!, result.outputIds.at(-1)!);
      expect(output.success).toBe(true);
      if (templateId === 'highlight' && output.success) expect(output.output.durationMs).toBe(10000);
    }
  });
  it('rejects wrong ports, cycles and invalid settings atomically', () => {
    const original = source();
    expect(applyEditorOperations(original, [add('look', 'look'), connect('a1', 'look')]).success).toBe(false);
    expect(applyEditorOperations(original, [add('one', 'speed'), connect('v1', 'one'), add('two', 'speed'), connect('one', 'two'), connect('two', 'one')]).success).toBe(false);
    expect(applyEditorOperations(original, [add('bad', 'speed', { rate: 0 })]).success).toBe(false);
    expect(applyEditorOperations(original, [add('bad', 'look', { argv: '-i secret' })]).success).toBe(false);
    expect(original.canvas).toBeUndefined();
    const badRange = run(original, [add('trim', 'trim', { startMs: 4000, endMs: 2000 }), connect('v1', 'trim')]);
    expect(evaluateCanvasBlock(badRange, badRange.canvas!, 'trim').success).toBe(false);
  });
});

describe('atomic editing operations', () => {
  it('covers tracks, source copies, keyframes, typography and caption style without partial writes', () => {
    const original = source();
    const next = run(original, [{ action: 'track.add', id: 'new-audio', kind: 'audio', name: 'Music' }, { action: 'track.rename', trackId: 'new-audio', name: 'Background music' },
      { action: 'track.mix', trackId: 'new-audio', mix: { gainDb: -6, pan: 0.25 } }, { action: 'clip.duplicate', clipId: 'v1', id: 'copy' },
      { action: 'clip.keyframe.add', clipId: 'copy', keyframe: { timelineTimeMs: 14500, property: 'opacity', value: 0.5, interpolation: 'linear' } },
      { action: 'title.add', id: 'title', atMs: 0, text: 'Caption' }, { action: 'title.update', titleId: 'title', changes: { style: { fontFamily: 'korean', shadow: { opacity: 0.7 } } } }, { action: 'title.preset', titleId: 'title', preset: 'boxed' }]);
    expect(next.tracks.find(track => track.id === 'new-audio')).toMatchObject({ name: 'Background music', mix: { gainDb: -6, pan: 0.25 } });
    expect(next.titles?.[0]?.style).toMatchObject({ fontFamily: 'korean', shadow: { opacity: 0.7, offsetX: 4 } });
    expect(next.tracks[0]!.clips.find(clip => clip.id === 'copy')?.keyframes.some(key => key.value === 0.5)).toBe(true);
    expect(applyEditorOperations(original, [{ action: 'track.add', id: 'new', kind: 'audio', name: 'New' }, { action: 'title.update', titleId: 'missing', changes: { text: 'bad' } }]).success).toBe(false);
    expect(original.tracks).toHaveLength(2);
    expect(applyEditorOperations(original, [{ action: 'clip.delete', clipId: 'v1', shell: 'rm' }]).success).toBe(false);
  });
});
