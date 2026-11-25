// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/renderer/src/AgentChatContext', () => ({ useAgentChat: () => ({ modelReady: true, setReasoningEffort: vi.fn() }) }));
vi.mock('../src/renderer/src/AiDomainModelContext', () => ({ useAiDomainModel: () => ({ selectedModel: () => ({ id: 'fixture' }) }) }));
vi.mock('../src/renderer/src/LlmProviderContext', () => ({ useLlmModel: () => ({ providerConfig: {} }) }));
vi.mock('../src/renderer/src/ChatGptAuthContext', () => ({ useChatGptAuth: () => ({ isConnected: false }) }));
vi.mock('../src/renderer/src/AgentModelPicker', () => ({ AgentModelPicker: () => null }));
vi.mock('../src/renderer/src/editor/shorts/ShortsCandidatePreview', () => ({ ShortsCandidatePreview: () => null }));
vi.mock('../src/renderer/src/editor/shorts/ShortsResultEditor', () => ({ ShortsResultEditor: () => null }));
vi.mock('../src/renderer/src/editor/shorts/ShortsBatchExportPanel', () => ({ ShortsBatchExportPanel: () => null }));

type Dom = Element & { value?: string; click: () => void };
const doc = () => (globalThis as unknown as { document: { createElement: (tag: string) => Dom; body: { appendChild: (node: Element) => void } } }).document;
const win = () => (globalThis as unknown as { window: object }).window;
let cleanup: (() => void) | undefined;
beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
afterEach(() => { act(() => cleanup?.()); cleanup = undefined; vi.restoreAllMocks(); });

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
  const draw = async (id: string | null) => act(async () => root.render(createElement(ShortsReviewWorkspace, {
    editor: { project: id === null ? null : { id, name: id,
      assets: [{ id: `asset-${id}`, displayName: `${id}.mp4`, kind: 'video', metadata: { durationMs: 100000 } }],
      timeline: { tracks: [], transitions: [] } }, isBusy: false, metadataProbeFailuresByAssetId: {}, refreshProjects: vi.fn() },
    onOpenMaterializedProject: vi.fn()
  })));
  const click = async (id: string) => act(async () => (container.querySelector(`[data-testid="${id}"]`) as Dom).click());
  return { container, draw, click };
}

describe('real mounted Shorts controller project boundary', () => {
  // Regression found independently on PR576: A start resolved after B list and
  // displayed job-A next to B.mp4 in the retained controller.
  it.each(['success', 'failure', 'return-A', 'delete'] as const)('ignores late A start after %s boundary', async (scenario) => {
    const start = deferred();
    const shortsList = vi.fn(async () => ({ ok: true, value: [] }));
    const shortsStart = vi.fn(() => start.promise);
    const { container, draw, click } = await setup({ shortsList, shortsStart });
    await draw('A'); await click('shorts-start-btn');
    expect(shortsStart).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'A' }));
    await draw(scenario === 'delete' ? null : 'B');
    if (scenario === 'return-A') await draw('A');
    await act(async () => start.resolve(scenario === 'failure'
      ? { ok: false, error: { code: 'INVALID_INPUT', message: 'Old A failure' } }
      : { ok: true, value: job('A') }));
    expect((container.querySelector('[data-testid="shorts-run-history-select"]') as Dom | null)?.value).not.toBe('job-A');
    expect(container.textContent).not.toContain('Old A failure');
    expect(container.querySelector('[data-testid="shorts-start-btn"]')?.textContent).not.toContain('시작 중');
    if (scenario !== 'delete') expect(container.querySelector('[data-testid="shorts-source-select"]')?.textContent).toContain(scenario === 'return-A' ? 'A.mp4' : 'B.mp4');
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
});
