// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalProjectSnapshot, MediaAsset } from '../src/shared/timelineTypes';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';
import { measuredReaPlan, reaPlanImportOperations, type ReaPrepareImportInput } from '../src/shared/reaVideoAnalysis';

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
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  save = vi.fn();
  Object.defineProperty(window, 'videoTool', { configurable: true, value: {
    listProjects: async () => ({ ok: true, value: [] }),
    openProject: async ({ projectId }: { projectId: string }) => ({ ok: true, value: snapshot(projectId) }),
    deleteProject: async () => ({ ok: true, value: null }),
    detachVideoAudio: async () => ({ ok: true, value: { asset: asset('audio') } }),
    onProjectTimelineChanged: () => () => {}, saveTimeline: save
  } });
  const hookPath = '../src/renderer/src/editor/useTimelineEditor';
  const { useTimelineEditor } = await import(hookPath) as { useTimelineEditor: () => EditorProbe };
  const hostPath = "../src/renderer/src/editor/ReaEditorAnalysisHost";
  const { ReaEditorAnalysisHost } = await import(hostPath) as { ReaEditorAnalysisHost: import('react').ComponentType<Record<string, unknown>> };
  function Probe() { editor = useTimelineEditor(); return createElement(ReaEditorAnalysisHost, { editor, locked: false }); }
  const node = document.createElement('div'); document.body.appendChild(node);
  const root = createRoot(node); cleanup = () => { root.unmount(); node.remove(); };
  await act(async () => { root.render(createElement(Probe)); });
  await act(async () => { await editor.openProject('A'); });
});
afterEach(() => act(() => cleanup()));

it('imports through the mounted host into one real history transaction, preserving prior dirty edits and save zero', async () => {
  const plan = measuredReaPlan({ projectId: 'A', assetId: 'asset' }, 2000, [1000]);
  Object.assign((window as unknown as { videoTool: object }).videoTool, {
    reaAnalysisRuntime: async () => ({ ok: true, value: { available: true } }),
    reaAnalysisStart: async () => ({ ok: true, value: { id: 'job', projectId: 'A', assetId: 'asset', status: 'review', plan } }),
    reaAnalysisCancel: vi.fn(async () => ({ ok: true, value: null })),
    reaAnalysisPrepareImport: vi.fn(async (input: ReaPrepareImportInput) => ({ ok: true, value: reaPlanImportOperations(plan, input.shotIds, input.trackId, input.prefix, input.atMs) }))
  });
  act(() => { editor.addTimelineTrack('audio'); editor.setPlayheadMs(5000); });
  const prior = editor.project!.timeline;
  const source = JSON.stringify(editor.project!.assets);
  act(() => editor.setPlayheadMs(5000));
  const button = (text: string) => [...document.querySelectorAll('button')].find(item => item.textContent === text)!;
  await act(async () => button('Local shot analysis').click());
  const region = document.querySelector<HTMLElement>('[aria-label="Local analysis tools"]')!;
  expect(region.tabIndex).toBe(0);
  expect(region.dataset.cuaProtected).toBe('chrome-menu');
  const toggle = button('Local shot analysis');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).not.toBeNull();
  region.focus();
  expect(document.activeElement).toBe(region);
  await act(async () => { const select = document.querySelector('select')!; select.value = 'asset'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => button('Analyze locally').click());
  await act(async () => document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await act(async () => button('Import reviewed original ranges').click());
  expect(editor.project!.timeline.tracks[0]!.clips).toHaveLength(2);
  expect(editor.hasUnsavedTimeline).toBe(true);
  const imported = editor.project!.timeline;
  act(() => editor.undoTimeline());
  expect(editor.project!.timeline).toEqual(prior);
  expect(editor.hasUnsavedTimeline).toBe(true);
  act(() => editor.redoTimeline());
  expect(editor.project!.timeline).toEqual(imported);
  expect(JSON.stringify(editor.project!.assets)).toBe(source);
  expect(save).not.toHaveBeenCalled();
  await act(async () => toggle.click());
  expect(region.tabIndex).toBe(-1);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('.rea-analysis')).toBeNull();
});

it.each(['placement', 'placement-ABA', 'restart', 'project', 'reload', 'delete', 'cancel'] as const)('rejects delayed preparation after %s', async change => {
  const plan = measuredReaPlan({ projectId: 'A', assetId: 'asset' }, 2000, [1000]);
  let finish!: (value: unknown) => void;
  const cancel = vi.fn(async () => ({ ok: true, value: null }));
  Object.assign((window as unknown as { videoTool: object }).videoTool, {
    reaAnalysisRuntime: async () => ({ ok: true, value: { available: true } }),
    reaAnalysisStart: async () => ({ ok: true, value: { id: 'job', projectId: 'A', assetId: 'asset', status: 'review', plan } }),
    reaAnalysisCancel: cancel,
    reaAnalysisPrepareImport: () => new Promise(resolve => { finish = resolve; })
  });
  act(() => editor.setPlayheadMs(5000));
  const button = (text: string) => [...document.querySelectorAll('button')].find(item => item.textContent === text)!;
  await act(async () => button('Local shot analysis').click());
  await act(async () => { const select = document.querySelector('select')!; select.value = 'asset'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => button('Analyze locally').click());
  await act(async () => document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await act(async () => button('Import reviewed original ranges').click());
  await act(async () => {
    if (change === 'placement') editor.setPlayheadMs(1000);
    else if (change === 'placement-ABA') editor.setPlayheadMs(1000);
    else if (change === 'restart') button('Analyze locally').click();
    else if (change === 'project') await editor.openProject('B');
    else if (change === 'reload') await editor.openProject('A');
    else if (change === 'delete') await editor.deleteCurrentProject();
    else button('Cancel analysis').click();
  });
  if (change === 'placement-ABA') await act(async () => editor.setPlayheadMs(5000));
  const before = editor.project?.timeline;
  await act(async () => finish({ ok: true, value: reaPlanImportOperations(plan, [plan.shots[0]!.id], 'track-0', 'late', 5000) }));
  expect(editor.project?.timeline).toEqual(before);
  expect(save).not.toHaveBeenCalled();
  if (change !== 'placement' && change !== 'placement-ABA') expect(cancel).toHaveBeenCalled();
});

