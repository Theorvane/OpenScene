import type { TimelineDocument } from './timelineTypes';
import { getOpaqueId, hasAllowedKeys, isPlainRecord } from './timelineValidationPrimitives';
import { canvasDefaultInputCount, canvasVariableInputs, validCanvasSettings } from './canvasBlockCatalog';
import { parseTimelineDocument } from './timelineDocumentValidators';

export const CANVAS_BLOCK_KINDS = ['video-sequence', 'audio-sequence', 'audio-mix', 'video-audio', 'trim', 'speed', 'delay', 'look', 'volume', 'transform', 'video-overlay', 'video-mute'] as const;
export type CanvasBlockKind = (typeof CANVAS_BLOCK_KINDS)[number];
export type CanvasPortType = 'video' | 'audio' | 'video-audio';
export type CanvasInputType = CanvasPortType | 'media' | 'visual';
export type CanvasPosition = { readonly x: number; readonly y: number };
export type CanvasBlock = {
  readonly id: string;
  readonly kind: CanvasBlockKind;
  readonly inputCount: number;
  readonly position: CanvasPosition;
  readonly settings?: Readonly<Record<string, number | string>>;
};
export type CanvasConnection = { readonly fromId: string; readonly toId: string; readonly input: number };
export type VideoCanvasGraph = {
  readonly blocks: readonly CanvasBlock[];
  readonly connections: readonly CanvasConnection[];
  readonly sourceTimeline?: TimelineDocument;
  readonly sourcePositions?: Readonly<Record<string, CanvasPosition>>;
};

export const EMPTY_CANVAS_GRAPH: VideoCanvasGraph = { blocks: [], connections: [] };
export const CANVAS_BLOCK_LIMIT = 64;
export const CANVAS_INPUT_LIMIT = 8;
export const CANVAS_BLOCK_LABELS: Readonly<Record<CanvasBlockKind, string>> = {
  'video-sequence': 'Join videos',
  'audio-sequence': 'Join audio',
  'audio-mix': 'Mix audio',
  'video-audio': 'Video + audio', trim: 'Trim range', speed: 'Change speed', delay: 'Start later', look: 'Colour look', volume: 'Set volume', transform: 'Transform picture', 'video-overlay': 'Picture in picture', 'video-mute': 'Mute video sound'
};

export function canvasInputType(block: CanvasBlock, input: number): CanvasInputType {
  if (block.kind === 'video-sequence') return 'video';
  if (block.kind === 'video-audio') return input === 0 ? 'video' : 'audio';
  if (['trim', 'speed', 'delay', 'volume'].includes(block.kind)) return 'media';
  if (['look', 'transform', 'video-mute'].includes(block.kind)) return 'visual';
  if (block.kind === 'video-overlay') return 'video';
  return 'audio';
}

export function canvasOutputType(timeline: TimelineDocument, graph: VideoCanvasGraph, id: string, visited = new Set<string>()): CanvasPortType | null {
  if (visited.has(id)) return null;
  visited.add(id);
  const block = graph.blocks.find(candidate => candidate.id === id);
  if (block !== undefined) {
    if (block.kind === 'video-sequence' || block.kind === 'video-overlay') return 'video';
    if (canvasDefaultInputCount(block.kind) === 1) {
      const edge = graph.connections.find(connection => connection.toId === id && connection.input === 0);
      return edge ? canvasOutputType(timeline, graph, edge.fromId, visited) : null;
    }
    return block.kind === 'video-audio' ? 'video-audio' : 'audio';
  }
  return canvasSourceTimeline(timeline, graph).tracks.find(track => track.clips.some(clip => clip.id === id))?.kind ?? null;
}

export function canvasPortMatches(source: CanvasPortType | null, input: CanvasInputType): boolean {
  return source !== null && (input === 'media' || source === input || (input === 'visual' && source !== 'audio'));
}

/** Inputs retain their original ranges after applying a processing graph. Newly added sources remain available. */
export function canvasSourceTimeline(timeline: TimelineDocument, graph: VideoCanvasGraph): TimelineDocument {
  if (!graph.sourceTimeline) return timeline;
  const base = graph.sourceTimeline;
  const known = new Set(base.tracks.flatMap(track => track.clips.map(clip => clip.id)));
  const tracks = [...base.tracks];
  for (const track of timeline.tracks) {
    const clips = track.clips.filter(clip => !known.has(clip.id));
    if (!clips.length) continue;
    const existing = tracks.findIndex(candidate => candidate.id === track.id);
    if (existing >= 0) tracks[existing] = { ...tracks[existing]!, clips: [...tracks[existing]!.clips, ...clips] };
    else tracks.push({ ...track, clips });
  }
  return { ...base, tracks };
}

export function parseVideoCanvasGraph(value: unknown): VideoCanvasGraph | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['blocks', 'connections', 'sourceTimeline', 'sourcePositions']) ||
      !Array.isArray(value.blocks) || value.blocks.length > CANVAS_BLOCK_LIMIT ||
      !Array.isArray(value.connections) || value.connections.length > CANVAS_BLOCK_LIMIT * CANVAS_INPUT_LIMIT) return null;
  const blocks: CanvasBlock[] = [];
  const ids = new Set<string>();
  for (const raw of value.blocks) {
    if (!isPlainRecord(raw) || !hasAllowedKeys(raw, ['id', 'kind', 'inputCount', 'position', 'settings'])) return null;
    const id = getOpaqueId(raw, 'id');
    if (id === null || ids.has(id) || !CANVAS_BLOCK_KINDS.includes(raw.kind as CanvasBlockKind) ||
        typeof raw.inputCount !== 'number' || !Number.isInteger(raw.inputCount) ||
        raw.inputCount < canvasDefaultInputCount(raw.kind as CanvasBlockKind) || raw.inputCount > CANVAS_INPUT_LIMIT ||
        (!canvasVariableInputs(raw.kind as CanvasBlockKind) && raw.inputCount !== canvasDefaultInputCount(raw.kind as CanvasBlockKind))) return null;
    if (raw.settings !== undefined && !validCanvasSettings(raw.kind as CanvasBlockKind, raw.settings)) return null;
    const position = raw.position;
    if (!isPlainRecord(position) || !hasAllowedKeys(position, ['x', 'y']) ||
        typeof position.x !== 'number' || typeof position.y !== 'number' ||
        !Number.isFinite(position.x) || !Number.isFinite(position.y) ||
        position.x < 0 || position.y < 0 || position.x > 20000 || position.y > 20000) return null;
    ids.add(id);
    blocks.push({ id, kind: raw.kind as CanvasBlockKind, inputCount: raw.inputCount, position: { x: position.x, y: position.y }, ...(raw.settings === undefined ? {} : { settings: raw.settings as Readonly<Record<string, number | string>> }) });
  }
  const connections: CanvasConnection[] = [];
  const inputs = new Set<string>();
  for (const raw of value.connections) {
    if (!isPlainRecord(raw) || !hasAllowedKeys(raw, ['fromId', 'toId', 'input'])) return null;
    const fromId = getOpaqueId(raw, 'fromId');
    const toId = getOpaqueId(raw, 'toId');
    const target = blocks.find(block => block.id === toId);
    if (fromId === null || toId === null || fromId === toId || target === undefined ||
        typeof raw.input !== 'number' || !Number.isInteger(raw.input) || raw.input < 0 || raw.input >= target.inputCount) return null;
    const key = toId + '/' + raw.input;
    if (inputs.has(key)) return null;
    inputs.add(key);
    connections.push({ fromId, toId, input: raw.input });
  }
  let sourceTimeline: TimelineDocument | undefined;
  if (value.sourceTimeline !== undefined) {
    if (!isPlainRecord(value.sourceTimeline) || 'canvas' in value.sourceTimeline) return null;
    const parsed = parseTimelineDocument(value.sourceTimeline);
    if (!parsed) return null;
    sourceTimeline = parsed;
  }
  let sourcePositions: Record<string, CanvasPosition> | undefined;
  if (value.sourcePositions !== undefined) {
    if (!isPlainRecord(value.sourcePositions) || Object.keys(value.sourcePositions).length > 10000) return null;
    sourcePositions = {};
    for (const [id, position] of Object.entries(value.sourcePositions)) {
      if (getOpaqueId({ id }, 'id') === null || !isPlainRecord(position) || !hasAllowedKeys(position, ['x', 'y']) ||
          typeof position.x !== 'number' || !Number.isFinite(position.x) || position.x < 0 || position.x > 20000 ||
          typeof position.y !== 'number' || !Number.isFinite(position.y) || position.y < 0 || position.y > 20000) return null;
      Object.defineProperty(sourcePositions, id, { value: { x: position.x, y: position.y }, enumerable: true, configurable: true, writable: true });
    }
  }
  return { blocks, connections, ...(sourceTimeline ? { sourceTimeline } : {}), ...(sourcePositions ? { sourcePositions } : {}) };
}

export type CanvasConnectionResult =
  | { readonly success: true; readonly graph: VideoCanvasGraph }
  | { readonly success: false; readonly error: string };

export function connectCanvasInput(
  timeline: TimelineDocument, graph: VideoCanvasGraph, connection: CanvasConnection
): CanvasConnectionResult {
  const target = graph.blocks.find(block => block.id === connection.toId);
  if (target === undefined || connection.input < 0 || connection.input >= target.inputCount || !Number.isInteger(connection.input)) {
    return { success: false, error: 'Choose an input on an existing block.' };
  }
  const sourceType = canvasOutputType(timeline, graph, connection.fromId);
  if (!canvasPortMatches(sourceType, canvasInputType(target, connection.input))) {
    return { success: false, error: 'This input requires ' + canvasInputType(target, connection.input) + '.' };
  }
  const connections = graph.connections.filter(edge => edge.toId !== connection.toId || edge.input !== connection.input);
  const pending = [connection.toId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (id === connection.fromId) return { success: false, error: 'This connection would create a loop.' };
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...connections.filter(edge => edge.fromId === id).map(edge => edge.toId));
  }
  return { success: true, graph: { ...graph, connections: [...connections, connection] } };
}
