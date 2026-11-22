import type { TimelineDocument } from './timelineTypes';
import { canvasSourceTimeline, connectCanvasInput, type CanvasBlock, type CanvasBlockKind, type VideoCanvasGraph } from './videoCanvasGraph';
import { canvasDefaultInputCount } from './canvasBlockCatalog';
import { evaluateCanvasBlock } from './videoCanvasBlocks';

export const CANVAS_TEMPLATES = [
  { id: 'highlight', label: 'Quick highlight', description: 'Join selected videos → keep the first 10 seconds → vivid colour.' },
  { id: 'video-music', label: 'Video with music', description: 'Join video, mute its original sound and add quieter music.' },
  { id: 'picture-in-picture', label: 'Picture in picture', description: 'Use the first video as a background and the second as an inset.' },
  { id: 'audio-bed', label: 'Voice and music mix', description: 'Mix selected audio sources and adjust their shared level.' }
] as const;
export type CanvasTemplateId = (typeof CANVAS_TEMPLATES)[number]['id'];

export function createCanvasTemplate(timeline: TimelineDocument, graph: VideoCanvasGraph, templateId: CanvasTemplateId, prefix: string, selectedIds?: readonly string[]): { readonly graph: VideoCanvasGraph; readonly rootId: string } {
  if (!CANVAS_TEMPLATES.some(template => template.id === templateId)) throw new Error('Choose a supported quick start.');
  const sources = canvasSourceTimeline(timeline, graph).tracks.flatMap(track => track.clips.map(clip => ({ id: clip.id, kind: track.kind })));
  if (selectedIds && (new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => !sources.some(source => source.id === id)))) throw new Error('Choose existing, distinct source clips.');
  const selected = selectedIds?.length ? selectedIds.map(id => sources.find(source => source.id === id)!) : sources;
  const videos = selected.filter(source => source.kind === 'video').map(source => source.id);
  const audio = selected.filter(source => source.kind === 'audio').map(source => source.id);
  let next = graph, count = 0;
  const add = (kind: CanvasBlockKind, inputs: readonly string[], settings?: CanvasBlock['settings']): string => {
    const id = `${prefix}:${++count}`;
    if (next.blocks.some(block => block.id === id) || sources.some(source => source.id === id)) throw new Error('Use a new unique workflow id.');
    const block: CanvasBlock = { id, kind, inputCount: Math.max(canvasDefaultInputCount(kind), inputs.length), position: { x: 380 + (count - 1) * 340, y: 48 + graph.blocks.length * 20 }, ...(settings ? { settings } : {}) };
    next = { ...next, blocks: [...next.blocks, block] };
    inputs.forEach((fromId, input) => {
      const result = connectCanvasInput(timeline, next, { fromId, toId: id, input });
      if (!result.success) throw new Error(result.error);
      next = result.graph;
    });
    return id;
  };
  const join = (ids: readonly string[], kind: 'video-sequence' | 'audio-mix'): string => {
    if (!ids.length || ids.length > 8) throw new Error('Choose between 1 and 8 matching source clips.');
    return ids.length === 1 ? ids[0]! : add(kind, ids);
  };
  let rootId: string;
  if (templateId === 'picture-in-picture') {
    if (videos.length !== 2) throw new Error('Select exactly two video sources for picture in picture.');
    rootId = add('video-overlay', videos);
  } else if (templateId === 'audio-bed') {
    rootId = add('volume', [join(audio, 'audio-mix')], { volume: 0.5 });
  } else {
    let video = join(videos, 'video-sequence');
    if (templateId === 'highlight') {
      const measured = evaluateCanvasBlock(timeline, next, video);
      if (!measured.success) throw new Error(measured.error);
      video = add('trim', [video], { startMs: 0, endMs: Math.min(10000, measured.output.durationMs) });
      rootId = add('look', [video], { preset: 'vivid', amount: 1 });
    } else {
      video = add('video-mute', [video]);
      const music = add('volume', [join(audio, 'audio-mix')], { volume: 0.25 });
      rootId = add('video-audio', [video, music]);
    }
  }
  return { graph: next, rootId };
}
