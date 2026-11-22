import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeRegisteredEditorTool } from '../src/main/mcpToolDispatch';
import { OpenVideoMcpServer } from '../src/main/openVideoMcpServer';
import { ProjectStore } from '../src/main/projectStore';
import { applyEditorOperations } from '../src/shared/editorOperations';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS, type TimelineDocument } from '../src/shared/timelineTypes';
import { canvasDefaultInputCount } from '../src/shared/canvasBlockCatalog';
import { canvasOutputType, connectCanvasInput, type CanvasBlockKind, type VideoCanvasGraph } from '../src/shared/videoCanvasGraph';

const timeline: TimelineDocument = { ...createInitialTimeline(), tracks: (['video', 'audio'] as const).map(kind => ({
  id: `track-${kind}`, name: kind, ...(kind === 'audio' ? { kind: 'audio' as const, mix: { ...DEFAULT_AUDIO_TRACK_MIX } } : { kind: 'video' as const }),
  clips: [{ id: kind, assetId: kind, timelineStartMs: 0, sourceStartMs: 0, sourceEndMs: 1000,
    sourceDurationMs: 1000, effects: { ...DEFAULT_CLIP_EFFECTS }, keyframes: [] }]
})) };
function graph(consumer: CanvasBlockKind, source = 'video', chained = false): VideoCanvasGraph {
  return {
    blocks: [{ id: 'trim', kind: 'trim', inputCount: 1, position: { x: 100, y: 0 } },
      ...(chained ? [{ id: 'volume', kind: 'volume' as const, inputCount: 1, position: { x: 200, y: 0 } }] : []),
      { id: 'consumer', kind: consumer, inputCount: canvasDefaultInputCount(consumer), position: { x: 300, y: 0 } }],
    connections: [{ fromId: source, toId: 'trim', input: 0 },
      ...(chained ? [{ fromId: 'trim', toId: 'volume', input: 0 }] : []),
      { fromId: chained ? 'volume' : 'trim', toId: 'consumer', input: 0 }]
  };
}

describe('typed Canvas upstream rewiring', () => {
  it.each(['look', 'transform', 'video-mute', 'video-sequence', 'video-overlay'] as const)('refuses audio rewiring beneath %s', kind => {
    const original = graph(kind), before = JSON.stringify(original);
    const result = connectCanvasInput(timeline, original, { fromId: 'audio', toId: 'trim', input: 0 });
    expect(result.success).toBe(false);
    expect(JSON.stringify(original)).toBe(before);
  });
  it.each(['audio-sequence', 'audio-mix'] as const)('refuses video rewiring beneath %s', kind => {
    expect(connectCanvasInput(timeline, graph(kind, 'audio'), { fromId: 'video', toId: 'trim', input: 0 }).success).toBe(false);
  });
  it('checks transitive consumers and rejects the entire agent/mobile edit batch', () => {
    const original = { ...timeline, canvas: graph('look', 'video', true) }, before = JSON.stringify(original);
    const result = applyEditorOperations(original, [
      { action: 'track.rename', trackId: 'track-video', name: 'Must not save' },
      { action: 'canvas.connect', fromId: 'audio', toId: 'trim', input: 0 }
    ]);
    expect(result.success).toBe(false);
    expect(JSON.stringify(original)).toBe(before);
  });
  it('checks downstream types when completing a previously unconnected input', () => {
    const original = graph('look');
    const incomplete = { ...original, connections: original.connections.filter(edge => edge.toId !== 'trim') };
    expect(connectCanvasInput(timeline, incomplete, { fromId: 'audio', toId: 'trim', input: 0 }).success).toBe(false);
  });
  it('allows a type change when downstream media ports accept it', () => {
    const result = connectCanvasInput(timeline, graph('speed', 'video', true), { fromId: 'audio', toId: 'trim', input: 0 });
    expect(result.success).toBe(true);
    if (result.success) expect(canvasOutputType(timeline, result.graph, 'consumer')).toBe('audio');
  });
  it('allows disconnecting an incompatible consumer before rewiring in one atomic batch', () => {
    const result = applyEditorOperations({ ...timeline, canvas: graph('look') }, [
      { action: 'canvas.disconnect', id: 'consumer', input: 0 },
      { action: 'canvas.connect', fromId: 'audio', toId: 'trim', input: 0 }
    ]);
    expect(result.success).toBe(true);
  });
  it('allows unchanged output types and keeps cycle rejection', () => {
    expect(connectCanvasInput(timeline, graph('look'), { fromId: 'video', toId: 'trim', input: 0 }).success).toBe(true);
    expect(connectCanvasInput(timeline, graph('look'), { fromId: 'consumer', toId: 'trim', input: 0 }).success).toBe(false);
  });
  it('does not persist or notify an invalid rewire through the registered desktop tool', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openscene-rewire-'));
    try {
      const store = new ProjectStore(directory), server = new OpenVideoMcpServer();
      server.setServices(store);
      const project = await store.create({ name: 'Typed workflow' });
      const notifications: string[] = [];
      server.setProjectTimelineChangeNotifier(id => notifications.push(id));
      const call = (operations: unknown[]) => executeRegisteredEditorTool(server, 'editProject', { projectId: project.id, operations });
      expect(await call([
        { action: 'canvas.add', id: 'video', kind: 'video-sequence' },
        { action: 'canvas.add', id: 'audio', kind: 'audio-sequence' },
        { action: 'canvas.add', id: 'trim', kind: 'trim' },
        { action: 'canvas.add', id: 'look', kind: 'look' },
        { action: 'canvas.connect', fromId: 'video', toId: 'trim', input: 0 },
        { action: 'canvas.connect', fromId: 'trim', toId: 'look', input: 0 }
      ])).toMatchObject({ ok: true, value: { success: true } });
      const before = await store.open(project.id);
      notifications.length = 0;
      expect(await call([
        { action: 'track.add', id: 'voice', kind: 'audio', name: 'Must not save' },
        { action: 'canvas.connect', fromId: 'audio', toId: 'trim', input: 0 }
      ])).toMatchObject({ ok: true, value: { success: false } });
      expect(await store.open(project.id)).toEqual(before);
      expect(notifications).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

});
