import type { TimelineDocument } from './timelineTypes';
import { getOpaqueId, hasAllowedKeys, isPlainRecord } from './timelineValidationPrimitives';

export const CANVAS_BLOCK_KINDS = ['video-sequence', 'audio-sequence', 'audio-mix', 'video-audio'] as const;
export type CanvasBlockKind = (typeof CANVAS_BLOCK_KINDS)[number];
export type CanvasPortType = 'video' | 'audio' | 'video-audio';
export type CanvasPosition = { readonly x: number; readonly y: number };
export type CanvasBlock = {
  readonly id: string;
  readonly kind: CanvasBlockKind;
  readonly inputCount: number;
  readonly position: CanvasPosition;
};
export type CanvasConnection = { readonly fromId: string; readonly toId: string; readonly input: number };
export type VideoCanvasGraph = {
  readonly blocks: readonly CanvasBlock[];
  readonly connections: readonly CanvasConnection[];
};

export const EMPTY_CANVAS_GRAPH: VideoCanvasGraph = { blocks: [], connections: [] };
export const CANVAS_BLOCK_LIMIT = 64;
export const CANVAS_INPUT_LIMIT = 8;
export const CANVAS_BLOCK_LABELS: Readonly<Record<CanvasBlockKind, string>> = {
  'video-sequence': 'Join videos',
  'audio-sequence': 'Join audio',
  'audio-mix': 'Mix audio',
  'video-audio': 'Video + audio'
};

export function canvasInputType(block: CanvasBlock, input: number): CanvasPortType {
  if (block.kind === 'video-sequence') return 'video';
  if (block.kind === 'video-audio') return input === 0 ? 'video' : 'audio';
  return 'audio';
}

export function canvasOutputType(timeline: TimelineDocument, graph: VideoCanvasGraph, id: string): CanvasPortType | null {
  const block = graph.blocks.find(candidate => candidate.id === id);
  if (block !== undefined) {
    if (block.kind === 'video-sequence') return 'video';
    return block.kind === 'video-audio' ? 'video-audio' : 'audio';
  }
  return timeline.tracks.find(track => track.clips.some(clip => clip.id === id))?.kind ?? null;
}

export function parseVideoCanvasGraph(value: unknown): VideoCanvasGraph | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['blocks', 'connections']) ||
      !Array.isArray(value.blocks) || value.blocks.length > CANVAS_BLOCK_LIMIT ||
      !Array.isArray(value.connections) || value.connections.length > CANVAS_BLOCK_LIMIT * CANVAS_INPUT_LIMIT) return null;
  const blocks: CanvasBlock[] = [];
  const ids = new Set<string>();
  for (const raw of value.blocks) {
    if (!isPlainRecord(raw) || !hasAllowedKeys(raw, ['id', 'kind', 'inputCount', 'position'])) return null;
    const id = getOpaqueId(raw, 'id');
    if (id === null || ids.has(id) || !CANVAS_BLOCK_KINDS.includes(raw.kind as CanvasBlockKind) ||
        typeof raw.inputCount !== 'number' || !Number.isInteger(raw.inputCount) ||
        raw.inputCount < 2 || raw.inputCount > CANVAS_INPUT_LIMIT ||
        (raw.kind === 'video-audio' && raw.inputCount !== 2)) return null;
    const position = raw.position;
    if (!isPlainRecord(position) || !hasAllowedKeys(position, ['x', 'y']) ||
        typeof position.x !== 'number' || typeof position.y !== 'number' ||
        !Number.isFinite(position.x) || !Number.isFinite(position.y) ||
        position.x < 0 || position.y < 0 || position.x > 20000 || position.y > 20000) return null;
    ids.add(id);
    blocks.push({ id, kind: raw.kind as CanvasBlockKind, inputCount: raw.inputCount, position: { x: position.x, y: position.y } });
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
  return { blocks, connections };
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
  if (sourceType === null || sourceType !== canvasInputType(target, connection.input)) {
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
