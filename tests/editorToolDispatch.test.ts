import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeRegisteredEditorTool } from '../src/main/mcpToolDispatch';
import { OpenVideoMcpServer } from '../src/main/openVideoMcpServer';
import { ProjectStore } from '../src/main/projectStore';

describe('registered editor tools over the renderer bridge', () => {
  it('discovers the complete block catalog while refusing arbitrary methods and invalid arguments', async () => {
    const server = new OpenVideoMcpServer();
    const result = await executeRegisteredEditorTool(server, 'getEditingCapabilities', {});
    expect(result).toMatchObject({ ok: true, value: { success: true, blocks: expect.any(Object) } });
    if (result.ok) expect(Object.keys((result.value as { blocks: object }).blocks)).toHaveLength(12);
    for (const name of ['constructor', 'setServices', 'readCapabilities', '__proto__', undefined]) {
      expect(await executeRegisteredEditorTool(server, name, {})).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    expect(await executeRegisteredEditorTool(server, 'editProject', { projectId: 'p', operations: [] }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('saves an agent batch once and refreshes the editor only after the entire batch succeeds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openscene-atomic-tools-'));
    try {
      const store = new ProjectStore(dir), server = new OpenVideoMcpServer();
      server.setServices(store);
      const project = await store.create({ name: 'Agent edits' });
      const notifications: string[] = [];
      server.setProjectTimelineChangeNotifier(id => notifications.push(id));
      const call = (operations: unknown[]) => executeRegisteredEditorTool(server, 'editProject', { projectId: project.id, operations });
      expect(await call([
        { action: 'track.add', id: 'voice', kind: 'audio', name: 'Voice' },
        { action: 'track.rename', trackId: 'missing', name: 'Invalid' }
      ])).toMatchObject({ ok: true, value: { success: false } });
      expect((await store.open(project.id))?.timeline).toEqual(project.timeline);
      expect(notifications).toEqual([]);
      expect(await call([
        { action: 'track.add', id: 'voice', kind: 'audio', name: 'Voice' },
        { action: 'canvas.add', id: 'level', kind: 'volume', settings: { volume: 0.3 } }
      ])).toMatchObject({ ok: true, value: { success: true, appliedOperations: 2, outputIds: ['level'] } });
      expect(notifications).toEqual([project.id]);
      expect((await store.open(project.id))?.timeline.canvas?.blocks[0]).toMatchObject({ kind: 'volume', settings: { volume: 0.3 } });
      expect(await executeRegisteredEditorTool(server, 'getCanvasWorkflow', { projectId: project.id }))
        .toMatchObject({ ok: true, value: { success: true, outputs: [{ blockId: 'level', ready: false }] } });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
