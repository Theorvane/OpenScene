// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LocalProjectSnapshot, TimelineDocument } from '../src/shared/timelineTypes';

vi.mock('../src/renderer/src/AgentChatContext', () => ({ useAgentChat: () => ({
  isBusy: false, pendingApproval: null, input: '', setInput: vi.fn(), modelReady: true, setReasoningEffort: vi.fn()
}) }));
vi.mock('../src/renderer/src/cua/useCuaOverlay', () => ({ useCuaActing: () => false, useCuaOverlay: () => ({ state: { phase: 'idle' }, triggerStop: vi.fn() }) }));
vi.mock('../src/renderer/src/ThemeProvider', () => ({ useTheme: () => ({ mode: 'dark', preset: 'neutral', setPreset: vi.fn(), toggleTheme: vi.fn() }) }));
vi.mock('../src/renderer/src/editor/useTimelineShortcuts', () => ({ useTimelineShortcuts: vi.fn() }));
vi.mock('../src/renderer/src/editor/useEditorNativeMenuCommands', () => ({ useEditorNativeMenuCommands: vi.fn() }));
vi.mock('../src/renderer/src/editor/AssetMetadataProbeHost', () => ({ AssetMetadataProbeHost: () => null }));
vi.mock('../src/renderer/src/editor/ExportPanel', () => ({ ExportPanel: () => null }));
vi.mock('../src/renderer/src/editor/InspectorPanel', () => ({ InspectorPanel: () => null }));
vi.mock('../src/renderer/src/editor/ProjectRail', () => ({ ProjectRail: () => null }));
vi.mock('../src/renderer/src/editor/TimelineEditorLeftDock', () => ({ TimelineEditorLeftDock: () => null }));
vi.mock('../src/renderer/src/editor/ProgramMonitor', () => ({ ProgramMonitor: () => null }));
vi.mock('../src/renderer/src/editor/TimelineCanvas', () => ({ TimelineCanvas: () => null }));
vi.mock('../src/renderer/src/editor/VideoConnectionCanvas', () => ({ VideoConnectionCanvas: () => null }));
vi.mock('../src/renderer/src/AiDomainModelContext', () => ({ useAiDomainModel: () => ({ selectedModel: () => ({ id: 'fixture' }) }) }));
vi.mock('../src/renderer/src/LlmProviderContext', () => ({ useLlmModel: () => ({ providerConfig: {} }) }));
vi.mock('../src/renderer/src/ChatGptAuthContext', () => ({ useChatGptAuth: () => ({ isConnected: false }) }));
vi.mock('../src/renderer/src/AgentModelPicker', () => ({ AgentModelPicker: () => null }));
vi.mock('../src/renderer/src/editor/shorts/ShortsCandidatePreview', () => ({ ShortsCandidatePreview: () => null }));
vi.mock('../src/renderer/src/editor/shorts/ShortsBatchExportPanel', () => ({ ShortsBatchExportPanel: () => null }));
vi.mock('../src/renderer/src/editor/shorts/ShortsResultEditor', () => ({ ShortsResultEditor: (props: {
  resultProject: LocalProjectSnapshot | null; isDirty: boolean;
  onChangeTimeline: (update: (timeline: TimelineDocument) => TimelineDocument) => void;
}) => createElement('button', { 'data-testid': 'real-draft-probe', onClick: () => props.onChangeTimeline((timeline) => ({ ...timeline,
  tracks: timeline.tracks.map((track) => ({ ...track, name: 'edited' })) })) }, JSON.stringify({ dirty: props.isDirty, name: props.resultProject?.timeline.tracks[0]?.name })) }));

let cleanup: (() => void) | undefined;
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe(): void {} unobserve(): void {} disconnect(): void {} } });
  const storage = { getItem: () => null, setItem: () => {} };
  vi.stubGlobal('localStorage', storage);
  Object.defineProperty((globalThis as unknown as { window: object }).window, 'localStorage', { configurable: true, value: storage });
});
afterEach(() => { act(() => cleanup?.()); cleanup = undefined; });

describe('real review draft lifetime in the mounted desktop host', () => {
  it.each(['empty-project', 'projectless', 'workspace-hidden'] as const)('retains unsaved A results when visiting %s and returning', async (boundary) => {
    const result = { id: 'result-A', assets: [], timeline: { tracks: [{ id: 'video', kind: 'video', name: 'original', clips: [] }], transitions: [] } };
    const job = { id: 'job-A', sourceProjectId: 'A', sourceAssetId: 'asset-A', stage: 'completed', cleanupComplete: true,
      createdAt: '2026-11-26', updatedAt: '2026-11-26', selection: { status: 'selected', warnings: [], candidates: [{
        id: 'candidate-A', startMs: 0, endMs: 1000, reason: 'fixture', evidenceIds: [], context: { completeThought: true, notes: 'fixture' }
      }] }, items: [{ candidateId: 'candidate-A', status: 'ready', resultProjectId: 'result-A' }] };
    const saves = vi.fn();
    const shortsList = vi.fn(async ({ projectId }: { projectId: string }) => ({ ok: true, value: projectId === 'A' ? [job] : [] }));
    Object.defineProperty((globalThis as unknown as { window: object }).window, 'videoTool', { configurable: true, value: {
      shortsList,
      openProject: async () => ({ ok: true, value: result }), saveTimeline: saves
    } });
    const path = '../src/renderer/src/editor/TimelineEditor.tsx';
    const { TimelineEditor } = await import(path) as { TimelineEditor: ComponentType<Record<string, unknown>> };
    const doc = (globalThis as unknown as { document: { createElement: (tag: string) => Element; body: { appendChild: (node: Element) => void } } }).document;
    const container = doc.createElement('div'); doc.body.appendChild(container);
    const root = createRoot(container); cleanup = () => { root.unmount(); container.remove(); };
    const draw = async (id: string | null, active = true) => act(async () => root.render(createElement(TimelineEditor, { active, editor: {
      project: id === null ? null : { id, name: id, assets: id === 'A' ? [{ id: 'asset-A', displayName: 'A.mp4', kind: 'video', metadata: { durationMs: 10000 } }] : [], timeline: { tracks: [], transitions: [] } },
      projects: ['A', 'B'].map((projectId) => ({ id: projectId, name: projectId, updatedAt: '2026-11-26' })),
      selectedAsset: null, selectedClip: null, isBusy: false, isSavingTimeline: false, hasUnsavedTimeline: false,
      statusMessage: { tone: 'neutral', text: '' }, metadataProbeFailuresByAssetId: {}, refreshProjects: vi.fn()
    } })));
    await draw('A');
    await act(async () => (container.querySelector('[data-testid="real-draft-probe"]') as unknown as { click: () => void }).click());
    expect(container.querySelector('[data-testid="real-draft-probe"]')?.textContent).toContain('"dirty":true');
    const requestsBeforeIntake = shortsList.mock.calls.length;
    await draw(boundary === 'empty-project' ? 'B' : boundary === 'projectless' ? null : 'A', boundary !== 'workspace-hidden');
    expect(container.querySelectorAll('[data-testid="shorts-review-workspace"]')).toHaveLength(0);
    expect(shortsList).toHaveBeenCalledTimes(requestsBeforeIntake);
    await draw('A');
    expect(container.querySelector('[data-testid="real-draft-probe"]')?.textContent).toContain('edited');
    expect(container.querySelector('[data-testid="real-draft-probe"]')?.textContent).toContain('"dirty":true');
    expect(saves).not.toHaveBeenCalled();
  });
});
