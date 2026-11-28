// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalProjectSnapshot, MediaAsset } from '../src/shared/timelineTypes';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';

function asset(kind: 'video' | 'audio'): MediaAsset {
  return { id: kind === 'video' ? 'asset' : 'extracted', displayName: kind, kind,
    projectRelativePath: `assets/${kind}`, mimeType: `${kind}/fixture`, byteLength: 1,
    metadata: { durationMs: 5000 }, createdAt: 'original', updatedAt: 'original' };
}
function snapshot(id = 'A'): LocalProjectSnapshot {
  return { schemaVersion: 4, id, name: id, createdAt: 'original', updatedAt: 'original', assets: [asset('video')],
    ai: {} as LocalProjectSnapshot['ai'], timeline: { schemaVersion: 3, transitions: [], tracks:
      ['video', 'audio', 'audio'].map((kind, index) => (kind === 'video' ? { id: `track-${index}`, kind: 'video' as const, name: kind, clips: [{ id: 'clip', assetId: 'asset', timelineStartMs: 0, sourceStartMs: 0, sourceEndMs: 5000, sourceDurationMs: 5000, effects: DEFAULT_CLIP_EFFECTS, keyframes: [] }] } : { id: `track-${index}`, kind: 'audio' as const, name: kind, mix: DEFAULT_AUDIO_TRACK_MIX, clips: [] })) } };
}
function deferred() {
  let resolve!: (value: { ok: true; value: LocalProjectSnapshot }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ ok: true; value: LocalProjectSnapshot }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type EditorProbe = {
  project: LocalProjectSnapshot | null; hasUnsavedTimeline: boolean; isSavingTimeline: boolean;
  timelineSaveError: string | null;
  openProject: (id: string) => Promise<boolean>; deleteCurrentProject: () => Promise<void>;
  saveTimeline: () => Promise<boolean>; addTimelineTrack: (kind: 'audio') => void;
  addTitleAtPlayhead: () => string | null; setPlayheadMs: (ms: number) => void;
  playheadMs: number; selectedClipId: string; setSelectedClipId: (id: string) => void;
  undoTimeline: () => void; redoTimeline: () => void;
  detachSelectedClipAudio: () => Promise<void>;
};
let editor: EditorProbe;
let cleanup: () => void;
let save: ReturnType<typeof vi.fn>;
let timelineChanged: (projectId: string) => void;
let openProject: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  save = vi.fn();
  openProject = vi.fn(async ({ projectId }: { projectId: string }) => ({ ok: true, value: snapshot(projectId) }));
  Object.defineProperty(window, 'videoTool', { configurable: true, value: {
    listProjects: async () => ({ ok: true, value: [] }),
    openProject,
    deleteProject: async () => ({ ok: true, value: { deleted: true } }),
    detachVideoAudio: async () => ({ ok: true, value: { asset: asset('audio') } }),
    onProjectTimelineChanged: (listener: (projectId: string) => void) => { timelineChanged = listener; return () => {}; }, saveTimeline: save
  } });
  const hookPath = '../src/renderer/src/editor/useTimelineEditor';
  const { useTimelineEditor } = await import(hookPath) as { useTimelineEditor: () => EditorProbe };
  function Probe() { editor = useTimelineEditor(); return null; }
  const node = document.createElement('div'); document.body.appendChild(node);
  const root = createRoot(node); cleanup = () => { root.unmount(); node.remove(); };
  await act(async () => { root.render(createElement(Probe)); });
  await act(async () => { await editor.openProject('A'); });
});
afterEach(() => act(() => cleanup()));

describe('manual Save ownership in the real timeline hook', () => {
  it('agent refresh preserves the shared playhead and adds one undo transaction', async () => {
    act(() => { editor.setPlayheadMs(500); editor.setSelectedClipId('clip'); });
    const before = editor.project!;
    const after = { ...before, timeline: { ...before.timeline, tracks: [...before.timeline.tracks, { id: 'agent-track', name: 'Agent', kind: 'audio' as const, clips: [] }] } };
    openProject.mockResolvedValueOnce({ ok: true, value: after });
    await act(async () => { timelineChanged('A'); });
    expect(editor.project!.timeline.tracks).toHaveLength(before.timeline.tracks.length + 1);
    expect(editor.playheadMs).toBe(500); expect(editor.selectedClipId).toBe('clip');
    expect(editor.hasUnsavedTimeline).toBe(false);
    act(() => editor.undoTimeline());
    expect(editor.project!.timeline).toEqual(before.timeline);
    expect(editor.hasUnsavedTimeline).toBe(true);
  });
  it('rejects an agent reload that resolves after a different project was opened', async () => {
    const pending = deferred();
    openProject.mockReturnValueOnce(pending.promise);
    act(() => timelineChanged('A'));
    await act(async () => { await editor.openProject('B'); });
    await act(async () => { pending.resolve({ ok: true, value: snapshot('A') }); });
    expect(editor.project?.id).toBe('B');
  });
  it('preserves completed audio detachment when an older manual Save resolves', async () => {
    act(() => { editor.setSelectedClipId('clip'); editor.setPlayheadMs(500); });
    const submitted = editor.project!;
    const pending = deferred(); save.mockReturnValueOnce(pending.promise);
    let result!: Promise<boolean>; act(() => { result = editor.saveTimeline(); });
    await act(async () => { await editor.detachSelectedClipAudio(); });
    const detached = editor.project!;
    const selection = editor.selectedClipId;
    expect(detached.timeline.tracks[0]!.clips[0]!.effects.volume).toBe(0);
    expect(detached.assets.some((item) => item.id === 'extracted')).toBe(true);
    expect(detached.timeline.tracks[1]!.clips).toHaveLength(1);
    expect(editor.hasUnsavedTimeline).toBe(true);
    await act(async () => { pending.resolve({ ok: true, value: submitted }); await result; });
    expect(await result).toBe(false); expect(editor.project).toBe(detached);
    expect(editor.hasUnsavedTimeline).toBe(true); expect(editor.selectedClipId).toBe(selection);
    expect(editor.playheadMs).toBe(500); expect(editor.isSavingTimeline).toBe(false);
    act(() => editor.undoTimeline());
    expect(editor.project!.timeline.tracks[0]!.clips[0]!.effects.volume).toBe(1);
    expect(editor.project!.timeline.tracks[1]!.clips).toHaveLength(0);
    act(() => editor.redoTimeline());
    expect(editor.project!.timeline.tracks[0]!.clips[0]!.effects.volume).toBe(0);
    expect(editor.project!.timeline.tracks[1]!.clips).toHaveLength(1);
  });
  it('preserves a fourth track, history, selection and dirty state; navigation save returns false', async () => {
    act(() => { editor.addTitleAtPlayhead(); });
    act(() => { editor.setPlayheadMs(500); editor.setSelectedClipId('selection'); });
    const pending = deferred(); save.mockReturnValueOnce(pending.promise);
    const submitted = editor.project!;
    let result!: Promise<boolean>;
    act(() => { result = editor.saveTimeline(); });
    act(() => editor.addTimelineTrack('audio'));
    await act(async () => { pending.resolve({ ok: true, value: { ...submitted, updatedAt: 'canonical' } }); await result; });
    expect(await result).toBe(false);
    expect(editor.project!.timeline.tracks).toHaveLength(4);
    expect(editor.hasUnsavedTimeline).toBe(true);
    expect(editor.isSavingTimeline).toBe(false);
    expect(editor.playheadMs).toBe(500); expect(editor.selectedClipId).toBe('selection');
    act(() => editor.undoTimeline());
    expect(editor.project!.timeline.tracks).toHaveLength(3);
    act(() => editor.redoTimeline());
    expect(editor.project!.timeline.tracks).toHaveLength(4);
  });

  it('accepts canonical metadata on a current save without resetting history or playback', async () => {
    act(() => editor.addTitleAtPlayhead());
    act(() => { editor.setPlayheadMs(500); editor.setSelectedClipId('selection'); });
    const submitted = editor.project!;
    save.mockResolvedValueOnce({ ok: true, value: { ...submitted, updatedAt: 'canonical', name: 'canonical name' } });
    await act(async () => { expect(await editor.saveTimeline()).toBe(true); });
    expect(editor.project!.updatedAt).toBe('canonical'); expect(editor.project!.name).toBe('canonical name');
    expect(editor.hasUnsavedTimeline).toBe(false); expect(editor.playheadMs).toBe(500);
    expect(editor.selectedClipId).toBe('selection');
    act(() => editor.undoTimeline()); expect(editor.hasUnsavedTimeline).toBe(true);
    expect(editor.project!.timeline.titles ?? []).toHaveLength(0);
  });

  it('does not accept an edit-then-undo generation even when content matches the submission', async () => {
    const pending = deferred(); save.mockReturnValueOnce(pending.promise);
    const submitted = editor.project!;
    let result!: Promise<boolean>; act(() => { result = editor.saveTimeline(); });
    act(() => editor.addTimelineTrack('audio'));
    act(() => editor.undoTimeline());
    await act(async () => { pending.resolve({ ok: true, value: submitted }); await result; });
    expect(await result).toBe(false); expect(editor.hasUnsavedTimeline).toBe(true);
    act(() => editor.redoTimeline()); expect(editor.project!.timeline.tracks).toHaveLength(4);
  });

  it.each(['B', 'A-B-A', 'delete'] as const)('isolates late responses after %s', async (target) => {
    const pending = deferred(); save.mockReturnValueOnce(pending.promise);
    const submitted = editor.project!;
    let result!: Promise<boolean>; act(() => { result = editor.saveTimeline(); });
    await act(async () => { if (target === 'delete') await editor.deleteCurrentProject(); else await editor.openProject('B'); });
    if (target === 'A-B-A') await act(async () => { await editor.openProject('A'); });
    const current = editor.project;
    await act(async () => { pending.resolve({ ok: true, value: { ...submitted, name: 'STALE' } }); await result; });
    expect(await result).toBe(false); expect(editor.project).toBe(current);
    expect(editor.isSavingTimeline).toBe(false); expect(editor.timelineSaveError).toBeNull();
  });

  it('rejects overlapping saves and prevents an old failure from settling a new project save', async () => {
    const old = deferred(); const current = deferred(); save.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    let first!: Promise<boolean>; act(() => { first = editor.saveTimeline(); });
    expect(await editor.saveTimeline()).toBe(false); expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { await editor.openProject('B'); });
    let second!: Promise<boolean>; act(() => { second = editor.saveTimeline(); });
    await act(async () => { old.reject(new Error('old failure')); await first; });
    expect(editor.isSavingTimeline).toBe(true); expect(editor.timelineSaveError).toBeNull();
    await act(async () => { current.resolve({ ok: true, value: { ...snapshot('B'), updatedAt: 'canonical' } }); await second; });
    expect(await second).toBe(true); expect(editor.project!.updatedAt).toBe('canonical');
    expect(editor.isSavingTimeline).toBe(false);
  });

  it('reports current failures while preserving unsaved edits', async () => {
    act(() => editor.addTimelineTrack('audio'));
    save.mockRejectedValueOnce(new Error('disk unavailable'));
    await act(async () => { expect(await editor.saveTimeline()).toBe(false); });
    expect(editor.timelineSaveError).toBe('disk unavailable'); expect(editor.hasUnsavedTimeline).toBe(true);
  });
});
