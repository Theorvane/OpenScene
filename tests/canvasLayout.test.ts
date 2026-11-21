import { describe, expect, it } from 'vitest';
import { layoutCanvas, CANVAS_LAYOUT_MODES, canvasBlockHeight } from '../src/shared/canvasLayout';
import { applyEditorOperations } from '../src/shared/editorOperations';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';
import { parseVideoCanvasGraph, type VideoCanvasGraph } from '../src/shared/videoCanvasGraph';

const timeline = { ...createInitialTimeline(), tracks: [{ id: 'v', kind: 'video' as const, name: 'Video', clips: ['one', 'two'].map((id, index) => ({ id, assetId: id, timelineStartMs: index * 1000, sourceStartMs: 0, sourceEndMs: 1000, sourceDurationMs: 1000, effects: { ...DEFAULT_CLIP_EFFECTS }, keyframes: [] })) }] };
const graph: VideoCanvasGraph = { sourcePositions: { one: { x: 200, y: 500 }, two: { x: 50, y: 100 } }, blocks: [
  { id: 'trim', kind: 'trim', inputCount: 1, position: { x: 800, y: 900 } },
  { id: 'join', kind: 'video-sequence', inputCount: 2, position: { x: 1000, y: 100 } },
  { id: 'look', kind: 'look', inputCount: 1, position: { x: 200, y: 300 } }
], connections: [{ fromId: 'one', toId: 'trim', input: 0 }, { fromId: 'trim', toId: 'join', input: 0 }, { fromId: 'two', toId: 'join', input: 1 }, { fromId: 'join', toId: 'look', input: 0 }] };
describe('shared node layout', () => {
  it('orders connected nodes left to right, includes sources and round-trips the saved layout', () => {
    const next = layoutCanvas(timeline, graph, 'flow');
    expect(next.sourcePositions?.one?.x).toBeLessThan(next.blocks[0]!.position.x);
    expect(next.blocks[0]!.position.x).toBeLessThan(next.blocks[1]!.position.x);
    expect(next.blocks[1]!.position.x).toBeLessThan(next.blocks[2]!.position.x);
    expect(next.connections).toEqual(graph.connections);
    expect(parseVideoCanvasGraph(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(layoutCanvas(timeline, next, 'flow')).toEqual(next);
    expect(timeline.tracks[0]!.clips).toHaveLength(2);
  });
  it('aligns selected source and block nodes while leaving other nodes untouched', () => {
    const left = layoutCanvas(timeline, graph, 'align-left', ['one', 'trim']);
    expect(left.sourcePositions?.one?.x).toBe(200);
    expect(left.blocks[0]!.position.x).toBe(200);
    expect(left.blocks[1]).toEqual(graph.blocks[1]);
    const top = layoutCanvas(timeline, graph, 'align-top', ['one', 'trim']);
    expect(top.sourcePositions?.one?.y).toBe(500);
    expect(top.blocks[0]!.position.y).toBe(500);
  });
  it('distributes using node dimensions and reserves space for block parameters in a grid', () => {
    const horizontal = layoutCanvas(timeline, graph, 'distribute-horizontal', ['trim', 'join', 'look']);
    const sorted = [...horizontal.blocks].sort((a, b) => a.position.x - b.position.x);
    expect(sorted[1]!.position.x - sorted[0]!.position.x - 280).toBe(sorted[2]!.position.x - sorted[1]!.position.x - 280);
    const vertical = layoutCanvas(timeline, graph, 'distribute-vertical', ['trim', 'join', 'look']);
    const rows = [...vertical.blocks].sort((a, b) => a.position.y - b.position.y);
    expect(rows[1]!.position.y - rows[0]!.position.y - canvasBlockHeight(rows[0]!)).toBe(rows[2]!.position.y - rows[1]!.position.y - canvasBlockHeight(rows[1]!));
    const grid = layoutCanvas(timeline, graph, 'grid');
    expect(grid.blocks[2]!.position.y).toBeGreaterThan(grid.blocks[0]!.position.y + canvasBlockHeight(grid.blocks[0]!));
  });
  it('exposes every arrangement to agent batches, rejects unknown nodes and refuses loops', () => {
    for (const mode of CANVAS_LAYOUT_MODES) expect(applyEditorOperations({ ...timeline, canvas: graph }, [{ action: 'canvas.layout', mode }]).success).toBe(true);
    expect(() => layoutCanvas(timeline, graph, 'flow', ['missing'])).toThrow('existing');
    expect(() => layoutCanvas(timeline, { ...graph, connections: [...graph.connections, { fromId: 'look', toId: 'trim', input: 0 }] }, 'flow')).toThrow('loop');
    expect(parseVideoCanvasGraph({ ...graph, sourcePositions: { one: { x: Infinity, y: 0 } } })).toBeNull();
  });
});
