import type { TimelineDocument } from './timelineTypes';
import { CANVAS_BLOCK_CATALOG } from './canvasBlockCatalog';
import { canvasSourceTimeline, type CanvasBlock, type CanvasPosition, type VideoCanvasGraph } from './videoCanvasGraph';

export const CANVAS_LAYOUT_MODES = ['flow', 'grid', 'align-left', 'align-top', 'distribute-horizontal', 'distribute-vertical'] as const;
export type CanvasLayoutMode = (typeof CANVAS_LAYOUT_MODES)[number];
export const canvasBlockHeight = (block: CanvasBlock): number => 160 + block.inputCount * 42 + Object.keys(CANVAS_BLOCK_CATALOG[block.kind].settings ?? {}).length * 42;

/** Shared document layout: desktop, mobile and agent all save the same coordinates. */
export function layoutCanvas(timeline: TimelineDocument, graph: VideoCanvasGraph, mode: CanvasLayoutMode, ids?: readonly string[]): VideoCanvasGraph {
  if (!CANVAS_LAYOUT_MODES.includes(mode)) throw new Error('Choose a supported node arrangement.');
  const sources = canvasSourceTimeline(timeline, graph).tracks.flatMap(track => track.clips);
  const all = [...sources.map((clip, index) => ({ id: clip.id, position: graph.sourcePositions?.[clip.id] ?? { x: 48, y: 48 + index * 260 }, width: 260, height: 230 })),
    ...graph.blocks.map(block => ({ id: block.id, position: block.position, width: 280, height: canvasBlockHeight(block) }))];
  if (ids && (new Set(ids).size !== ids.length || ids.some(id => !all.some(node => node.id === id)))) throw new Error('Select existing, distinct nodes.');
  const nodes = ids?.length ? all.filter(node => ids.includes(node.id)) : all;
  if (!nodes.length) return graph;
  const positions = new Map<string, CanvasPosition>();
  const place = (id: string, x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 20000 || y > 20000) throw new Error('This arrangement exceeds the canvas bounds. Select fewer nodes or use a grid.');
    positions.set(id, { x: Math.round(x), y: Math.round(y) });
  };
  if (mode === 'flow') {
    const depths = new Map<string, number>(), active = new Set<string>();
    const depth = (id: string): number => {
      if (depths.has(id)) return depths.get(id)!;
      if (active.has(id)) throw new Error('Disconnect the loop before arranging the workflow.');
      active.add(id);
      const parents = graph.connections.filter(edge => edge.toId === id && nodes.some(node => node.id === edge.fromId));
      const value = parents.length ? 1 + Math.max(...parents.map(edge => depth(edge.fromId))) : graph.blocks.some(block => block.id === id) ? 1 : 0;
      active.delete(id); depths.set(id, value); return value;
    };
    nodes.forEach(node => depth(node.id));
    const center = (id: string): number => {
      const parents = graph.connections.filter(edge => edge.toId === id).map(edge => positions.get(edge.fromId)?.y).filter((value): value is number => value !== undefined);
      return parents.length ? parents.reduce((sum, y) => sum + y, 0) / parents.length : all.findIndex(node => node.id === id) * 260;
    };
    for (const column of [...new Set(depths.values())].sort((a, b) => a - b)) {
      let y = 48;
      for (const node of nodes.filter(node => depths.get(node.id) === column).sort((a, b) => center(a.id) - center(b.id))) {
        place(node.id, 48 + column * 310, y); y += node.height + 48;
      }
    }
  } else if (mode === 'grid') {
    let y = 48;
    for (let index = 0; index < nodes.length; index += 4) {
      const row = nodes.slice(index, index + 4);
      row.forEach((node, column) => place(node.id, 48 + column * 340, y));
      y += Math.max(...row.map(node => node.height)) + 48;
    }
  } else if (mode === 'align-left' || mode === 'align-top') {
    const x = Math.min(...nodes.map(node => node.position.x)), y = Math.min(...nodes.map(node => node.position.y));
    nodes.forEach(node => place(node.id, mode === 'align-left' ? x : node.position.x, mode === 'align-top' ? y : node.position.y));
  } else {
    const horizontal = mode === 'distribute-horizontal';
    const sorted = [...nodes].sort((a, b) => horizontal ? a.position.x - b.position.x : a.position.y - b.position.y);
    const first = sorted[0]!, last = sorted.at(-1)!;
    const start = horizontal ? first.position.x : first.position.y;
    const end = horizontal ? last.position.x + last.width : last.position.y + last.height;
    const totalSize = sorted.reduce((sum, node) => sum + (horizontal ? node.width : node.height), 0);
    const gap = sorted.length > 1 ? Math.max(48, (end - start - totalSize) / (sorted.length - 1)) : 0;
    let cursor = start;
    sorted.forEach(node => { place(node.id, horizontal ? cursor : node.position.x, horizontal ? node.position.y : cursor); cursor += (horizontal ? node.width : node.height) + gap; });
  }
  const sourcePositions = { ...graph.sourcePositions };
  sources.forEach(clip => { const position = positions.get(clip.id); if (position) sourcePositions[clip.id] = position; });
  return { ...graph, sourcePositions, blocks: graph.blocks.map(block => ({ ...block, position: positions.get(block.id) ?? block.position })) };
}
