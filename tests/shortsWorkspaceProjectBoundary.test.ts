// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LocalProjectSnapshot, TimelineDocument } from '../src/shared/timelineTypes';

vi.mock('../src/renderer/src/AgentChatContext', () => ({ useAgentChat: () => ({ modelReady: true, setReasoningEffort: vi.fn() }) }));
vi.mock('../src/renderer/src/AiDomainModelContext', () => ({ useAiDomainModel: () => ({ selectedModel: () => ({ id: 'fixture' }) }) }));
vi.mock('../src/renderer/src/LlmProviderContext', () => ({ useLlmModel: () => ({ providerConfig: {} }) }));
vi.mock('../src/renderer/src/ChatGptAuthContext', () => ({ useChatGptAuth: () => ({ isConnected: false }) }));
vi.mock('../src/renderer/src/AgentModelPicker', () => ({ AgentModelPicker: () => null }));
vi.mock('../src/renderer/src/editor/shorts/ShortsCandidatePreview', () => ({ ShortsCandidatePreview: () => null }));
vi.mock('../src/renderer/src/editor/shorts/ShortsResultEditor', () => ({ ShortsResultEditor: (props: {
  resultProject: LocalProjectSnapshot | null; isDirty: boolean; statusMessage: string | null;
  onChangeTimeline: (update: (timeline: TimelineDocument) => TimelineDocument) => void; onSaveTimeline: () => void;
}) => createElement('div', { 'data-testid': 'result-probe' },
  createElement('output', {}, JSON.stringify({ dirty: props.isDirty, name: props.resultProject?.timeline.tracks[0]?.name, status: props.statusMessage })),
  createElement('button', { 'data-testid': 'edit-result-probe', onClick: () => props.onChangeTimeline((timeline) => ({ ...timeline,
    tracks: timeline.tracks.map((track) => ({ ...track, name: `edited-${props.resultProject?.id}` })) })) }, 'edit'),
  createElement('button', { 'data-testid': 'save-result-probe', onClick: props.onSaveTimeline }, 'save')) }));
vi.mock('../src/renderer/src/editor/shorts/ShortsBatchExportPanel', () => ({ ShortsBatchExportPanel: () => null }));

type Dom = Element & { value?: string; click: () => void };
const doc = () => (globalThis as unknown as { document: { createElement: (tag: string) => Dom; body: { appendChild: (node: Element) => void } } }).document;
const win = () => (globalThis as unknown as { window: object }).window;
let cleanup: (() => void) | undefined;
beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
afterEach(() => { act(() => cleanup?.()); cleanup = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function job(sourceProjectId: string, stage = 'review') {
  return { id: `job-${sourceProjectId}`, sourceProjectId, sourceAssetId: `asset-${sourceProjectId}`,
    stage, cleanupComplete: stage === 'review', createdAt: '2026-11-26', updatedAt: '2026-11-26', items: [] };
}
async function setup(api: Record<string, unknown>) {
  Object.defineProperty(win(), 'videoTool', { configurable: true, value: api });
  const path = '../src/renderer/src/editor/shorts/ShortsReviewWorkspace.tsx';
  const { ShortsReviewWorkspace } = await import(path) as { ShortsReviewWorkspace: ComponentType<Record<string, unknown>> };
  const container = doc().createElement('div'); doc().body.appendChild(container);
  const root = createRoot(container);
  cleanup = () => { root.unmount(); container.remove(); };
  const draw = async (id: string | null, knownIds = ['A', 'B']) => act(async () => root.render(createElement(ShortsReviewWorkspace, {
    editor: { project: id === null ? null : { id, name: id,
      assets: [{ id: `asset-${id}`, displayName: `${id}.mp4`, kind: 'video', metadata: { durationMs: 100000 } }],
      timeline: { tracks: [], transitions: [] } }, projects: knownIds.map((projectId) => ({ id: projectId })), isBusy: false, metadataProbeFailuresByAssetId: {}, refreshProjects: vi.fn() },
    onOpenMaterializedProject: vi.fn()
  })));
  const click = async (id: string) => act(async () => (container.querySelector(`[data-testid="${id}"]`) as Dom).click());
  return { container, draw, click };
}

describe('real mounted Shorts controller project boundary', () => {
  it('cannot resurrect a late job after the old host is externally unmounted', async () => {
    const start = deferred();
    const shortsStart = vi.fn(() => start.promise);
    const api = { shortsList: async () => ({ ok: true, value: [] }), shortsStart };
    const first = await setup(api);
    await first.draw('A'); await first.click('shorts-start-btn');
    act(() => cleanup?.()); cleanup = undefined;
    const reopened = await setup(api); await reopened.draw('B');
    await act(async () => start.resolve({ ok: true, value: job('A') }));
    expect((reopened.container.querySelector('[data-testid="shorts-run-history-select"]') as Dom | null)?.value).not.toBe('job-A');
    expect(shortsStart).toHaveBeenCalledOnce();
  });
  // Regression found independently on PR576: A start resolved after B list and
  // displayed job-A next to B.mp4 in the retained controller.
  it.each(['success', 'failure', 'return-A', 'delete'] as const)('isolates late A start across %s boundary', async (scenario) => {
    const start = deferred();
    const shortsList = vi.fn(async () => ({ ok: true, value: [] }));
    const shortsStart = vi.fn(() => start.promise);
    const { container, draw, click } = await setup({ shortsList, shortsStart });
    await draw('A'); await click('shorts-start-btn');
    expect(shortsStart).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'A' }));
    await draw(scenario === 'delete' ? null : 'B', scenario === 'delete' ? ['B'] : ['A', 'B']);
    if (scenario === 'return-A') await draw('A');
    await act(async () => start.resolve(scenario === 'failure'
      ? { ok: false, error: { code: 'INVALID_INPUT', message: 'Old A failure' } }
      : { ok: true, value: job('A') }));
    const run = (container.querySelector('[data-testid="shorts-run-history-select"]') as Dom | null)?.value;
    if (scenario === 'return-A') expect(run).toBe('job-A');
    else expect(run).not.toBe('job-A');
    expect(container.textContent).not.toContain('Old A failure');
    expect(container.querySelector('[data-testid="shorts-start-btn"]')?.textContent).not.toContain('시작 중');
    if (scenario !== 'delete') expect(container.querySelector('[data-testid="shorts-source-select"]')?.textContent).toContain(scenario === 'return-A' ? 'A.mp4' : 'B.mp4');
    if (scenario === 'delete') {
      await draw('A');
      expect((container.querySelector('[data-testid="shorts-run-history-select"]') as Dom | null)?.value).not.toBe('job-A');
    }
  });

  it('does not refresh or reinsert an old job after its delayed cancel response', async () => {
    const cancel = deferred();
    const shortsGet = vi.fn();
    const shortsList = vi.fn(async ({ projectId }: { projectId: string }) => ({ ok: true, value: projectId === 'A' ? [job('A', 'selecting')] : [] }));
    const { container, draw, click } = await setup({ shortsList, shortsGet, shortsCancel: () => cancel.promise });
    await draw('A'); await click('shorts-cancel-btn'); await draw('B');
    await act(async () => cancel.resolve({ ok: true, value: { accepted: true } }));
    expect(shortsGet).not.toHaveBeenCalled();
    expect((container.querySelector('[data-testid="shorts-run-history-select"]') as Dom | null)?.value).not.toBe('job-A');
    expect(container.querySelector('[data-testid="shorts-source-select"]')?.textContent).toContain('B.mp4');
  });

  it('retains independent A and B dirty result drafts through visits, failed save, and clean-cache eviction pressure without implicit save', async () => {
    const knownIds = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const result = (sourceId: string) => ({ id: `result-${sourceId}`, assets: [],
      timeline: { tracks: [{ id: 'video', kind: 'video', name: 'original', clips: [] }], transitions: [] } });
    const readyJob = (sourceId: string) => ({ ...job(sourceId, 'completed'), cleanupComplete: true,
      selection: { status: 'selected', candidates: [{ id: `candidate-${sourceId}`, startMs: 0, endMs: 1000, reason: 'fixture', evidenceIds: [], context: { completeThought: true, notes: 'fixture' } }], warnings: [] },
      items: [{ candidateId: `candidate-${sourceId}`, status: 'ready', resultProjectId: `result-${sourceId}` }] });
    const openProject = vi.fn(async ({ projectId }: { projectId: string }) => ({ ok: true, value: result(projectId.slice('result-'.length)) }));
    const failedSave = deferred();
    const saveTimeline = vi.fn(() => failedSave.promise);
    const { container, draw, click } = await setup({
      shortsList: async ({ projectId }: { projectId: string }) => ({ ok: true, value: [readyJob(projectId)] }), openProject, saveTimeline
    });
    await draw('A', knownIds); await click('edit-result-probe');
    expect(container.querySelector('[data-testid="result-probe"]')?.textContent).toContain('edited-result-A');
    await draw('B', knownIds); await click('edit-result-probe');
    expect(container.querySelector('[data-testid="result-probe"]')?.textContent).toContain('edited-result-B');
    await draw('A', knownIds);
    const probe = () => container.querySelector('[data-testid="result-probe"]')!.textContent;
    expect(probe()).toContain('"dirty":true'); expect(probe()).toContain('edited-result-A');
    expect(saveTimeline).not.toHaveBeenCalled();
    await click('save-result-probe'); await draw('B', knownIds);
    await act(async () => failedSave.resolve({ ok: false, error: { code: 'IO_ERROR', message: 'Fixture save failed' } }));
    expect(probe()).toContain('edited-result-B'); expect(probe()).not.toContain('Fixture save failed');
    await draw('A', knownIds); expect(probe()).toContain('Fixture save failed'); expect(probe()).toContain('"dirty":true');
    for (const id of ['C', 'D', 'E', 'F', 'G']) await draw(id, knownIds);
    await draw('B', knownIds); expect(probe()).toContain('edited-result-B'); expect(probe()).toContain('"dirty":true');
    await draw('A', knownIds); expect(probe()).toContain('edited-result-A'); expect(probe()).toContain('"dirty":true');
    expect(container.querySelectorAll('[data-testid="shorts-review-workspace"]')).toHaveLength(1);
    expect(saveTimeline).toHaveBeenCalledOnce();
    expect(openProject.mock.calls.filter(([arg]) => arg.projectId === 'result-A')).toHaveLength(1);
    await draw('G', knownIds.filter((id) => id !== 'A'));
    await draw('A', knownIds);
    expect(probe()).toContain('original'); expect(probe()).toContain('"dirty":false');
    expect(openProject.mock.calls.filter(([arg]) => arg.projectId === 'result-A')).toHaveLength(2);
  });

  it('pauses inactive source polling and routes two deferred start responses only to their own source', async () => {
    const starts = { A: deferred(), B: deferred() };
    const shortsGet = vi.fn(async () => ({ ok: true, value: job('A', 'selecting') }));
    const { container, draw, click } = await setup({
      shortsList: async () => ({ ok: true, value: [] }), shortsGet,
      shortsStart: ({ projectId }: { projectId: 'A' | 'B' }) => starts[projectId].promise
    });
    await draw('A'); await click('shorts-start-btn'); await draw('B'); await click('shorts-start-btn');
    await act(async () => starts.A.resolve({ ok: true, value: job('A', 'selecting') }));
    expect((container.querySelector('[data-testid="shorts-run-history-select"]') as Dom | null)?.value).not.toBe('job-A');
    vi.useFakeTimers(); await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(shortsGet).not.toHaveBeenCalled();
    await act(async () => starts.B.resolve({ ok: true, value: job('B') }));
    expect((container.querySelector('[data-testid="shorts-run-history-select"]') as Dom | null)?.value).toBe('job-B');
    expect(container.querySelector('[data-testid="shorts-source-select"]')?.textContent).toContain('B.mp4');
  });
});
