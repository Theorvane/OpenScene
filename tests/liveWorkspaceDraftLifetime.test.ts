// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

vi.mock('../src/renderer/src/AgentChatContext', () => ({ useAgentChat: () => ({ isBusy: false, pendingApproval: null }) }));
vi.mock('../src/renderer/src/cua/useCuaOverlay', () => ({ useCuaActing: () => false, useCuaOverlay: () => null }));
vi.mock('../src/renderer/src/ThemeProvider', () => ({ useTheme: () => ({ mode: 'dark', preset: 'neutral', setPreset: vi.fn(), toggleTheme: vi.fn() }) }));
vi.mock('../src/renderer/src/editor/useTimelineShortcuts', () => ({ useTimelineShortcuts: vi.fn() }));
vi.mock('../src/renderer/src/editor/useEditorNativeMenuCommands', () => ({ useEditorNativeMenuCommands: vi.fn() }));
vi.mock('../src/renderer/src/editor/AssetMetadataProbeHost', () => ({ AssetMetadataProbeHost: () => null }));
vi.mock('../src/renderer/src/editor/ExportPanel', () => ({ ExportPanel: () => null }));
vi.mock('../src/renderer/src/editor/InspectorPanel', () => ({ InspectorPanel: () => null }));
vi.mock('../src/renderer/src/editor/TimelineEditorLeftDock', () => ({ TimelineEditorLeftDock: () => null }));
vi.mock('../src/renderer/src/editor/VideoResultsList', () => ({ VideoResultsList: () => null }));
vi.mock('../src/renderer/src/editor/EditorPreview', () => ({ EditorPreview: ({ editor }: { editor: { project: { timeline: { tracks: unknown[] } }; playheadMs: number } }) => createElement('output', { 'data-testid': 'shared-preview' }, `${editor.project.timeline.tracks.length}:${editor.playheadMs}`) }));
vi.mock('../src/renderer/src/editor/TimelineCanvas', () => ({ TimelineCanvas: () => null }));
vi.mock('../src/renderer/src/editor/VideoConnectionCanvas', () => ({ VideoConnectionCanvas: () => null }));

it('preserves the actual unsaved draft, selection and undo across all three modes', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
  const snapshot = { id: 'p', name: 'Project', assets: [], timeline: { tracks: [{ id: 'v', kind: 'video', name: 'Video', clips: [] }], transitions: [] } };
  Object.assign(window, { videoTool: { listProjects: async () => ({ ok: true, value: [] }), openProject: async () => ({ ok: true, value: snapshot }), onProjectTimelineChanged: () => () => {} } });
  const hookPath = '../src/renderer/src/editor/useTimelineEditor';
  const componentPath = '../src/renderer/src/editor/TimelineEditor';
  const { useTimelineEditor } = await import(hookPath);
  const { TimelineEditor } = await import(componentPath) as { TimelineEditor: ComponentType<Record<string, unknown>> };
  let editor!: ReturnType<typeof useTimelineEditor>;
  function Host() { editor = useTimelineEditor(); return editor.project ? createElement(TimelineEditor, { editor }) : null; }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Host)));
    await act(async () => { await editor.openProject('p'); });
    act(() => { editor.addTimelineTrack('audio'); editor.setSelectedClipId('selection'); });
    const draft = editor.project;
    for (const mode of ['precision', 'node', 'natural']) {
      act(() => container.querySelector(`[data-testid="mode-tab-${mode}"]`)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      expect(editor.project).toBe(draft);
      expect(editor.hasUnsavedTimeline).toBe(true);
      expect(editor.selectedClipId).toBe('selection');
      expect(container.querySelector('[data-testid="shared-preview"]')?.textContent).toBe('2:0');
    }
    act(() => editor.undoTimeline());
    expect(editor.project!.timeline.tracks).toHaveLength(1);
    act(() => editor.redoTimeline());
    expect(editor.project!.timeline.tracks).toHaveLength(2);
  } finally { act(() => root.unmount()); }
});
