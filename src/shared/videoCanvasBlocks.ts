import { clipDurationMs, clipSpeed } from './timelineClipGeometry';
import { parseTimelineDocument } from './timelineDocumentValidators';
import { transitionsAreValid } from './timelineMetadataValidators';
import type { AudioTrackMix, PersistedTimelineClip, TimelineDocument, TimelineTrack } from './timelineTypes';
import { DEFAULT_AUDIO_TRACK_MIX } from './timelineTypes';
import { canvasInputType, canvasOutputType, canvasPortMatches, canvasSourceTimeline, type CanvasBlock, type CanvasPortType, type VideoCanvasGraph } from './videoCanvasGraph';
import { canvasSettings, canvasDefaultInputCount } from './canvasBlockCatalog';
import { visualEffectValues, type VisualEffectPresetId } from './visualEffectPresets';
import { isValidClipEffects } from './timelineEffects';

type BlockClip = { readonly clip: PersistedTimelineClip; readonly offsetMs: number };
type BlockLane = { readonly kind: 'video' | 'audio'; readonly clips: readonly BlockClip[]; readonly mix: AudioTrackMix };
export type CanvasBlockOutput = {
  readonly type: CanvasPortType;
  readonly lanes: readonly BlockLane[];
  readonly durationMs: number;
};
export type CanvasBlockResult =
  | { readonly success: true; readonly output: CanvasBlockOutput }
  | { readonly success: false; readonly error: string };

function assemble(block: CanvasBlock, inputs: readonly CanvasBlockOutput[]): CanvasBlockOutput {
  const settings = canvasSettings(block);
  if (canvasDefaultInputCount(block.kind) === 1) {
    const input = inputs[0]!;
    let durationMs = input.durationMs;
    const start = Number(settings.startMs ?? 0), end = Number(settings.endMs || input.durationMs);
    if (block.kind === 'trim' && (start >= end || end > input.durationMs)) throw new Error('Choose a trim range inside the input duration.');
    if (block.kind === 'speed') durationMs /= Number(settings.rate);
    if (block.kind === 'delay') durationMs += Number(settings.delayMs);
    const lanes = input.lanes.map(lane => ({ ...lane, clips: lane.clips.flatMap(item => {
      let clip = item.clip, offsetMs = item.offsetMs;
      if (block.kind === 'trim') {
        const left = Math.max(start, offsetMs), right = Math.min(end, offsetMs + clipDurationMs(clip));
        if (right <= left) return [];
        const originalStart = clip.timelineStartMs, delta = left - offsetMs;
        clip = { ...clip, timelineStartMs: originalStart + delta,
          sourceStartMs: clip.sourceStartMs + delta * clipSpeed(clip), sourceEndMs: clip.sourceStartMs + (right - offsetMs) * clipSpeed(clip),
          keyframes: clip.keyframes.filter(key => key.timelineTimeMs >= originalStart + delta && key.timelineTimeMs <= originalStart + right - offsetMs) };
        offsetMs = left - start;
      }
      if (block.kind === 'speed') {
        const rate = Number(settings.rate);
        clip = { ...clip, effects: { ...clip.effects, speed: clipSpeed(clip) * rate },
          keyframes: clip.keyframes.map(key => ({ ...key, timelineTimeMs: clip.timelineStartMs + (key.timelineTimeMs - clip.timelineStartMs) / rate })) };
        offsetMs /= rate;
      }
      if (block.kind === 'delay') offsetMs += Number(settings.delayMs);
      if (block.kind === 'look' && lane.kind === 'video') clip = { ...clip, effects: { ...clip.effects, ...visualEffectValues(settings.preset as VisualEffectPresetId, Number(settings.amount)) } };
      if (block.kind === 'volume') clip = { ...clip, effects: { ...clip.effects, volume: Number(settings.volume) } };
      if (block.kind === 'video-mute' && lane.kind === 'video') clip = { ...clip, effects: { ...clip.effects, volume: 0 } };
      if (block.kind === 'transform' && lane.kind === 'video') clip = { ...clip, effects: { ...clip.effects,
        scale: Number(settings.scale), positionX: Number(settings.positionX), positionY: Number(settings.positionY), rotation: Number(settings.rotation), opacity: Number(settings.opacity) } };
      if (!isValidClipEffects(clip.effects)) throw new Error('The resulting clip speed or effects exceed the supported range.');
      return [{ clip, offsetMs }];
    }) })).filter(lane => lane.clips.length > 0);
    if (!lanes.length) throw new Error('This range contains no media. Choose a range containing a clip.');
    if (block.kind === 'trim') durationMs = Math.max(...lanes.flatMap(lane => lane.clips.map(item => item.offsetMs + clipDurationMs(item.clip))));
    return { type: input.type, lanes, durationMs };
  }
  if (block.kind === 'video-overlay') return {
    type: 'video', durationMs: Math.max(...inputs.map(input => input.durationMs)),
    lanes: [...inputs[1]!.lanes.map(lane => ({ ...lane, clips: lane.clips.map(item => ({ ...item, clip: { ...item.clip,
      effects: { ...item.clip.effects, scale: Number(settings.scale), positionX: Number(settings.positionX), positionY: Number(settings.positionY), opacity: Number(settings.opacity) }
    } })) })), ...inputs[0]!.lanes]
  };
  const sequential = block.kind === 'video-sequence' || block.kind === 'audio-sequence';
  let cursor = 0;
  const lanes = inputs.flatMap(input => {
    const startMs = sequential ? cursor : 0;
    cursor += input.durationMs;
    return input.lanes.map(lane => ({
      ...lane, clips: lane.clips.map(item => ({ ...item, offsetMs: item.offsetMs + startMs }))
    }));
  });
  // Video joins share a track, while audio lanes retain their own gain and pan.
  const outputLanes = block.kind === 'video-sequence'
    ? [{ kind: 'video' as const, mix: { ...DEFAULT_AUDIO_TRACK_MIX }, clips: lanes.flatMap(lane => lane.clips) }]
    : lanes;
  return {
    type: block.kind === 'video-sequence' ? 'video' : block.kind === 'video-audio' ? 'video-audio' : 'audio',
    lanes: outputLanes,
    durationMs: sequential ? cursor : Math.max(...inputs.map(input => input.durationMs))
  };
}

export function evaluateCanvasBlock(timeline: TimelineDocument, graph: VideoCanvasGraph, rootId: string): CanvasBlockResult {
  const sources = canvasSourceTimeline(timeline, graph);
  const active = new Set<string>();
  const cache = new Map<string, CanvasBlockResult>();
  const evaluate = (id: string): CanvasBlockResult => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    if (active.has(id)) return { success: false, error: 'The workflow contains a loop. Disconnect one of its inputs.' };
    const block = graph.blocks.find(candidate => candidate.id === id);
    if (block === undefined) {
      const track = sources.tracks.find(candidate => candidate.clips.some(clip => clip.id === id));
      const clip = track?.clips.find(candidate => candidate.id === id);
      if (track === undefined || clip === undefined) return { success: false, error: 'A source clip was removed. Reconnect that input.' };
      return {
        success: true,
        output: {
          type: track.kind, durationMs: clipDurationMs(clip),
          lanes: [{ kind: track.kind, mix: track.kind === 'audio' ? track.mix : { ...DEFAULT_AUDIO_TRACK_MIX }, clips: [{ clip, offsetMs: 0 }] }]
        }
      };
    }
    active.add(id);
    const inputs: CanvasBlockOutput[] = [];
    for (let index = 0; index < block.inputCount; index++) {
      const edge = graph.connections.find(candidate => candidate.toId === id && candidate.input === index);
      if (edge === undefined) { active.delete(id); return { success: false, error: 'Connect input ' + (index + 1) + ' before applying this block.' }; }
      if (!canvasPortMatches(canvasOutputType(timeline, graph, edge.fromId), canvasInputType(block, index))) {
        active.delete(id);
        return { success: false, error: 'An input has the wrong media type. Reconnect it.' };
      }
      const result = evaluate(edge.fromId);
      if (!result.success) { active.delete(id); return result; }
      inputs.push(result.output);
    }
    active.delete(id);
    let output: CanvasBlockOutput;
    try { output = assemble(block, inputs); }
    catch (error: unknown) { return { success: false, error: error instanceof Error ? error.message : 'This block cannot process the input.' }; }
    const sourceIds = output.lanes.flatMap(lane => lane.clips.map(item => item.clip.id));
    if (new Set(sourceIds).size !== sourceIds.length) {
      return { success: false, error: 'A clip is used twice in this output. Duplicate it in Timeline to use a second copy.' };
    }
    const result = { success: true as const, output };
    cache.set(id, result);
    return result;
  };
  return evaluate(rootId);
}

export type ApplyCanvasBlockResult =
  | { readonly success: true; readonly timeline: TimelineDocument }
  | { readonly success: false; readonly error: string };

export function applyCanvasBlock(timeline: TimelineDocument, graph: VideoCanvasGraph, blockId: string): ApplyCanvasBlockResult {
  if (!graph.blocks.some(block => block.id === blockId)) return { success: false, error: 'The selected block no longer exists.' };
  const needsSourceSnapshot = graph.blocks.some(block => !['video-sequence', 'audio-sequence', 'audio-mix', 'video-audio'].includes(block.kind));
  if (needsSourceSnapshot) {
    const { canvas: _canvas, ...sourceTimeline } = canvasSourceTimeline(timeline, graph);
    graph = { ...graph, sourceTimeline };
  }
  const result = evaluateCanvasBlock(timeline, graph, blockId);
  if (!result.success) return result;
  // Consume every source in this branch, including clips entirely removed by a trim.
  // Otherwise an excluded tail would remain on its old track and still be exported.
  const selected = new Set<string>(), visited = new Set<string>();
  const consume = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    if (!graph.blocks.some(block => block.id === id)) { selected.add(id); return; }
    graph.connections.filter(edge => edge.toId === id).forEach(edge => consume(edge.fromId));
  };
  consume(blockId);
  const tracks: TimelineTrack[] = timeline.tracks.map(track => ({
    ...track, clips: track.clips.filter(clip => !selected.has(clip.id))
  }));
  const reused = new Set<string>();
  for (const [index, lane] of result.output.lanes.entries()) {
    const clips = lane.clips.map(({ clip, offsetMs }) => ({
      ...clip, timelineStartMs: offsetMs,
      keyframes: clip.keyframes.map(keyframe => ({
        ...keyframe, timelineTimeMs: keyframe.timelineTimeMs + offsetMs - clip.timelineStartMs
      }))
    }));
    const available = tracks.findIndex(track => track.kind === lane.kind && track.clips.length === 0 && !reused.has(track.id));
    let id = available < 0 ? 'canvas-' + blockId + '-' + index : tracks[available]!.id;
    while (available < 0 && tracks.some(track => track.id === id)) id += '-next';
    const track: TimelineTrack = lane.kind === 'video'
      ? { id, name: 'Joined video', kind: 'video', clips }
      : { id, name: 'Audio ' + (index + 1), kind: 'audio', clips, mix: lane.mix };
    reused.add(id);
    if (available < 0) tracks.push(track);
    else tracks[available] = track;
  }
  const next = parseTimelineDocument({
    ...timeline, tracks, canvas: graph,
    transitions: timeline.transitions.filter(transition => transitionsAreValid([transition], tracks))
  });
  return next === null
    ? { success: false, error: 'This output exceeds the timeline limits. Use fewer input clips or tracks.' }
    : { success: true, timeline: next };
}
