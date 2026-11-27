// @vitest-environment jsdom
import { act, createElement, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  stop: vi.fn(),
  chat: { isBusy: false, pendingApproval: null, input: '', setInput: vi.fn() },
  shortcuts: vi.fn()
}));
vi.mock('../src/renderer/src/AgentChatContext', () => ({ useAgentChat: () => fixture.chat }));
vi.mock('../src/renderer/src/cua/useCuaOverlay', () => ({ useCuaActing: () => false, useCuaOverlay: () => ({ state: { phase: 'idle' }, triggerStop: fixture.stop }) }));
vi.mock('../src/renderer/src/ThemeProvider', () => ({ useTheme: () => ({ mode: 'dark', preset: 'neutral', setPreset: vi.fn(), toggleTheme: vi.fn() }) }));
vi.mock('../src/renderer/src/editor/useTimelineShortcuts', () => ({ useTimelineShortcuts: fixture.shortcuts }));
vi.mock('../src/renderer/src/editor/useEditorNativeMenuCommands', () => ({ useEditorNativeMenuCommands: vi.fn() }));
vi.mock('../src/renderer/src/editor/AssetMetadataProbeHost', () => ({ AssetMetadataProbeHost: () => null }));
vi.mock('../src/renderer/src/editor/ExportPanel', () => ({ ExportPanel: () => null }));
vi.mock('../src/renderer/src/editor/InspectorPanel', () => ({ InspectorPanel: () => null }));
vi.mock('../src/renderer/src/editor/ProjectRail', () => ({ ProjectRail: () => null }));
vi.mock('../src/renderer/src/editor/TimelineEditorLeftDock', () => ({ TimelineEditorLeftDock: () => null }));
vi.mock('../src/renderer/src/editor/ProgramMonitor', () => ({ ProgramMonitor: ({ editor }: { editor: Record<string, unknown> }) => createElement('div', { 'data-probe': 'monitor' }, `${editor.playheadMs}:${editor.isPlaying}`) }));
vi.mock('../src/renderer/src/editor/TimelineCanvas', () => ({ TimelineCanvas: () => createElement('div', { 'data-probe': 'timeline', 'data-cua-safe-surface': 'timeline' }) }));
vi.mock('../src/renderer/src/editor/VideoConnectionCanvas', () => ({ VideoConnectionCanvas: () => createElement('div', { 'data-probe': 'canvas' }) }));
vi.mock('../src/renderer/src/editor/shorts/ShortsReviewWorkspace', () => ({ ShortsReviewWorkspace: () => {
  const [draft, setDraft] = useState(0);
  return createElement('button', { 'data-probe': 'shorts', onClick: () => setDraft(draft + 1) }, String(draft));
} }));

let unmount: (() => void) | undefined;
beforeAll(() => {
  const storage = new Map<string, string>();
  const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
  vi.stubGlobal('localStorage', localStorage);
  Object.defineProperty((globalThis as unknown as { window: object }).window, 'localStorage', { configurable: true, value: localStorage });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class { observe(): void {} unobserve(): void {} disconnect(): void {} } });
});
afterEach(() => { act(() => unmount?.()); unmount = undefined; vi.clearAllMocks(); });

describe('mounted desktop workspace host', () => {
  it('defaults to natural, retains real controller and mounted review/monitor/timeline across modes, and wires save/Undo/Stop', async () => {
    const modulePath = '../src/renderer/src/editor/TimelineEditor.tsx';
    const { TimelineEditor } = await import(modulePath) as { TimelineEditor: ComponentType<Record<string, unknown>> };
    const editor = {
      project: { id: 'project', name: '긴 한국어 프로젝트 이름', assets: [{ id: 'asset', metadata: { durationMs: 5000 } }], timeline: { tracks: [] } },
      projects: [{ id: 'project', name: '긴 한국어 프로젝트 이름', updatedAt: '2026-11-26' }],
      selectedAsset: null, selectedClip: null, hasUnsavedTimeline: true, canUndoTimeline: true,
      isBusy: false, isSavingTimeline: false, timelineSaveStatus: 'idle', statusMessage: { tone: 'neutral', text: '' },
      playheadMs: 1234, isPlaying: true, setIsPlaying: vi.fn(), saveTimeline: vi.fn().mockResolvedValue(true), undoTimeline: vi.fn()
    };
    const doc = (globalThis as unknown as { document: { createElement: (tag: string) => Element; body: { appendChild: (node: Element) => void } } }).document;
    const container = doc.createElement('div'); doc.body.appendChild(container);
    const root = createRoot(container);
    unmount = () => { root.unmount(); container.remove(); };
    await act(async () => root.render(createElement(TimelineEditor, { editor })));
    const button = (testId: string) => container.querySelector(`[data-testid="${testId}"]`)!;
    const KeyboardEventCtor = (globalThis as unknown as { KeyboardEvent: new (name: string, opts: object) => Event }).KeyboardEvent;
    const changeMode = (mode: string) => act(() => { button(`mode-tab-${mode}`).dispatchEvent(new KeyboardEventCtor('keydown', { key: 'Enter', bubbles: true })); });
    expect(container.querySelector('[data-workspace-mode]')?.getAttribute('data-workspace-mode')).toBe('natural');
    const shorts = container.querySelector('[data-probe="shorts"]')!;
    const timeline = container.querySelector('[data-probe="timeline"]')!;
    const monitor = container.querySelector('[data-probe="monitor"]')!;
    expect(timeline.closest('[hidden]')).not.toBeNull();
    act(() => (shorts as unknown as { click: () => void }).click());
    for (const mode of ['precision', 'node', 'natural']) {
      changeMode(mode);
      expect(container.querySelector('[data-probe="shorts"]')).toBe(shorts);
      expect(container.querySelector('[data-probe="timeline"]')).toBe(timeline);
      expect(container.querySelector('[data-probe="monitor"]')).toBe(monitor);
      expect(shorts.textContent).toBe('1');
      expect(monitor.textContent).toBe('1234:true');
      expect(timeline.closest('[hidden]') === null).toBe(mode === 'precision');
      expect(container.querySelector('[aria-label="Local analysis tools"]') !== null).toBe(mode === 'precision');
    }
    expect(editor.setIsPlaying).not.toHaveBeenCalled();
    const click = (id: string) => act(() => (button(id) as unknown as { click: () => void }).click());
    click('workspace-save-btn'); click('workspace-undo-btn'); click('workspace-cua-stop-btn');
    expect(editor.saveTimeline).toHaveBeenCalledOnce(); expect(editor.undoTimeline).toHaveBeenCalledOnce(); expect(fixture.stop).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('저장되지 않은 변경 있음');
    expect(fixture.shortcuts).toHaveBeenLastCalledWith(expect.objectContaining({ isLocked: true }));
  });
});
