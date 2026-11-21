import { clipDurationMs } from './timelineClipGeometry';
import { parseTimelineDocument } from './timelineDocumentValidators';
import { transitionsAreValid } from './timelineMetadataValidators';
import type { AudioTrackMix, PersistedTimelineClip, TimelineDocument, TimelineTrack } from './timelineTypes';
import { DEFAULT_AUDIO_TRACK_MIX } from './timelineTypes';
import { canvasInputType, canvasOutputType, type CanvasBlock, type CanvasPortType, type VideoCanvasGraph } from './videoCanvasGraph';

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
  const active = new Set<string>();
  const cache = new Map<string, CanvasBlockResult>();
  const evaluate = (id: string): CanvasBlockResult => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    if (active.has(id)) return { success: false, error: 'The workflow contains a loop. Disconnect one of its inputs.' };
    const block = graph.blocks.find(candidate => candidate.id === id);
    if (block === undefined) {
      const track = timeline.tracks.find(candidate => candidate.clips.some(clip => clip.id === id));
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
      if (canvasOutputType(timeline, graph, edge.fromId) !== canvasInputType(block, index)) {
        active.delete(id);
        return { success: false, error: 'An input has the wrong media type. Reconnect it.' };
      }
      const result = evaluate(edge.fromId);
      if (!result.success) { active.delete(id); return result; }
      inputs.push(result.output);
    }
    active.delete(id);
    const output = assemble(block, inputs);
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
  const result = evaluateCanvasBlock(timeline, graph, blockId);
  if (!result.success) return result;
  const selected = new Set(result.output.lanes.flatMap(lane => lane.clips.map(item => item.clip.id)));
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
