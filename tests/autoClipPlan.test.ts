import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planAutoClipEdit } from '../src/shared/autoClipPlan';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { applyEditorOperations } from '../src/shared/editorOperations';
import type { MediaAsset } from '../src/shared/timelineTypes';
import { executeRegisteredEditorTool } from '../src/main/mcpToolDispatch';
import { OpenVideoMcpServer } from '../src/main/openVideoMcpServer';
import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { ProjectStore } from '../src/main/projectStore';
import { AGENT_CHAT_READ_ONLY_TOOL_NAMES } from '../src/main/agentChatTools';

const asset: MediaAsset = { id: 'source', displayName: 'Talk', projectRelativePath: 'media/source.mp4', kind: 'video', mimeType: 'video/mp4', byteLength: 10, metadata: { durationMs: 60000 }, createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z' };
const timeline = createInitialTimeline();
const input = { assetId: 'source', prefix: 'highlights', segments: [{ start_time: 5.5, end_time: 10 }, { start_time: 20, end_time: 25 }] };

describe('AutoClip approved edit bridge', () => {
  it('converts source seconds to a reviewable atomic batch without modifying inputs', () => {
    const before = JSON.stringify(timeline);
    const result = planAutoClipEdit(timeline, [asset], input);
    expect(result).toMatchObject({ success: true, durationMs: 9500, segmentCount: 2, requiresApproval: true });
    if (!result.success) throw new Error(result.error);
    const applied = applyEditorOperations(timeline, result.operations, [asset]);
    expect(applied.success).toBe(true);
    if (applied.success) expect(applied.timeline.tracks.find(t => t.id === 'highlights:track')?.clips.map(c => [c.timelineStartMs, c.sourceStartMs, c.sourceEndMs])).toEqual([[0, 5500, 10000], [4500, 20000, 25000]]);
    expect(JSON.stringify(timeline)).toBe(before);
  });
  it.each([[-1, 1], [2, 1], [0, 0], [NaN, 1], [0, Infinity], [0, 61], [0, 0.0001]])('rejects invalid source ranges %s %s', (start_time, end_time) => {
    expect(planAutoClipEdit(timeline, [asset], { ...input, segments: [{ start_time, end_time }] }).success).toBe(false);
  });
  it('refuses missing metadata, paths, collisions and excessive plans', () => {
    expect(planAutoClipEdit(timeline, [{ ...asset, metadata: null }], input).success).toBe(false);
    expect(planAutoClipEdit(timeline, [asset], { ...input, prefix: '/tmp/path' }).success).toBe(false);
    expect(planAutoClipEdit(timeline, [asset], { ...input, segments: Array(33).fill(input.segments[0]) }).success).toBe(false);
    const result = planAutoClipEdit(timeline, [asset], input);
    if (!result.success) throw new Error(result.error);
    const applied = applyEditorOperations(timeline, result.operations, [asset]);
    if (!applied.success) throw new Error(applied.error);
    expect(planAutoClipEdit(applied.timeline, [asset], input).success).toBe(false);
  });
  it('registers a read-only preview tool without persistence or notifications', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autoclip-bridge-'));
    try {
      const store = new ProjectStore(root), project = await store.create({ name: 'AutoClip' });
      const server = new OpenVideoMcpServer(); server.setServices(store);
      const notifications: string[] = []; server.setProjectTimelineChangeNotifier(id => notifications.push(id));
      expect(await executeRegisteredEditorTool(server, 'planAutoClipEdit', { projectId: project.id, ...input })).toMatchObject({ ok: true, value: { success: false } });
      expect(await executeRegisteredEditorTool(server, 'planAutoClipEdit', { projectId: project.id, ...input, segments: [] })).toMatchObject({ ok: false });
      expect((await store.open(project.id))?.timeline).toEqual(project.timeline);
      expect(notifications).toEqual([]);
      expect(AGENT_CHAT_READ_ONLY_TOOL_NAMES.has('planAutoClipEdit')).toBe(true);
      expect(AGENT_CHAT_READ_ONLY_TOOL_NAMES.has('editProject')).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('previews real imported media, then persists only through editProject', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autoclip-import-'));
    try {
      const sourcePath = join(root, 'talk.wav'); await writeFile(sourcePath, Buffer.from([1, 2, 3]));
      const store = new ProjectStore(join(root, 'projects')), project = await store.create({ name: 'Talk' });
      const library = new AssetLibraryStore(join(root, 'projects'), store);
      const imported = await library.import({ projectId: project.id, sourcePath, kind: 'audio', displayName: 'Talk', mimeType: 'audio/wav' });
      await library.updateMetadata({ projectId: project.id, assetId: imported.id, durationMs: 60000 });
      const server = new OpenVideoMcpServer(); server.setServices(store);
      const notifications: string[] = []; server.setProjectTimelineChangeNotifier(id => notifications.push(id));
      const before = await store.open(project.id);
      const preview = await executeRegisteredEditorTool(server, 'planAutoClipEdit', { projectId: project.id, ...input, assetId: imported.id });
      expect(preview).toMatchObject({ ok: true, value: { success: true, requiresApproval: true, durationMs: 9500 } });
      expect(await store.open(project.id)).toEqual(before);
      expect(notifications).toEqual([]);
      if (!preview.ok) throw new Error('Preview failed');
      const operations = (preview.value as { operations: unknown[] }).operations;
      expect(await executeRegisteredEditorTool(server, 'editProject', { projectId: project.id, operations })).toMatchObject({ ok: true, value: { success: true } });
      expect(notifications).toEqual([project.id]);
      const reopened = await new ProjectStore(join(root, 'projects')).open(project.id);
      expect(reopened?.timeline.tracks.find(track => track.id === 'highlights:track')?.clips).toHaveLength(2);
      expect(reopened?.assets).toEqual(before?.assets);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('includes the organization fork and preserves MIT attribution', () => {
    expect(readFileSync('.gitmodules', 'utf8')).toContain('https://github.com/Theorvane/autoclip.git');
    expect(readFileSync('external/autoclip/LICENSE', 'utf8')).toContain('MIT License');
  });
});
