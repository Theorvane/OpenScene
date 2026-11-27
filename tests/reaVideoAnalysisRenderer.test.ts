// @vitest-environment jsdom
import { createElement, act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { measuredReaPlan, reaPlanImportOperations, reaVideoMarkdown, type ReaAnalysisJob, type ReaPrepareImportInput } from '../src/shared/reaVideoAnalysis';
import type { MediaAsset } from '../src/shared/timelineTypes';

afterEach(() => vi.unstubAllGlobals());
it('mounts, analyzes, reviews and emits original-range editor operations without saving', async () => {
  const componentPath = '../src/renderer/components/workspace/ReaVideoAnalysisWorkspace';
  const { ReaVideoAnalysisWorkspace } = await import(componentPath) as { ReaVideoAnalysisWorkspace: ComponentType<Record<string, unknown>> };
  vi.useFakeTimers();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const plan = measuredReaPlan({ projectId: 'project', assetId: 'source' }, 2000, [1000]);
  const running: ReaAnalysisJob = { projectId: 'project', assetId: 'source', id: 'job', status: 'running', cleanupComplete: false };
  const api = {
    reaAnalysisRuntime: vi.fn(async () => ({ ok: true, value: { available: true, upstreamPython: 'not-used' } })),
    reaAnalysisStart: vi.fn(async () => ({ ok: true, value: running })),
    reaAnalysisGet: vi.fn(async () => ({ ok: true, value: { ...running, status: 'review', cleanupComplete: true, plan, videoMd: reaVideoMarkdown(plan) } })),
    reaAnalysisCancel: vi.fn(async () => ({ ok: true, value: { ...running, status: 'cancelled' } })),
    reaAnalysisPrepareImport: vi.fn(async (input: ReaPrepareImportInput) => ({ ok: true, value: reaPlanImportOperations(plan, input.shotIds, input.trackId, input.prefix, input.atMs) })), saveTimeline: vi.fn()
  };
  Object.defineProperty(window, 'videoTool', { configurable: true, value: api });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const onImportOperations = vi.fn();
  const asset: MediaAsset = { id: 'source', kind: 'video', displayName: 'Fixture', mimeType: 'video/mp4', projectRelativePath: 'assets/source.mp4', byteLength: 100, metadata: { durationMs: 2000 }, createdAt: '', updatedAt: '' };
  try {
    await act(async () => { root.render(createElement(ReaVideoAnalysisWorkspace, { projectId: 'project', sourceEpoch: 'source-v1', assets: [asset], trackId: 'video', atMs: 500, onImportOperations })); });
    const select = host.querySelector('select')!;
    await act(async () => { select.value = 'source'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const button = (text: string) => Array.from(host.querySelectorAll('button')).find(button => button.textContent === text)!;
    await act(async () => button('Analyze locally').click());
    expect(api.reaAnalysisStart).toHaveBeenCalledWith({ projectId: 'project', assetId: 'source' });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(host.textContent).toContain('No models called; no video generated');
    await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
    await act(async () => button('Import reviewed original ranges').click());
    expect(onImportOperations).toHaveBeenCalledOnce();
    expect(onImportOperations.mock.calls[0]![0]).toEqual([expect.objectContaining({ action: 'clip.add', assetId: 'source', startMs: 500, sourceStartMs: 0, sourceEndMs: 1000 })]);
    expect(api.saveTimeline).not.toHaveBeenCalled();
    expect(onImportOperations.mock.calls[0]![1]).toEqual({ projectId: 'project', sourceEpoch: 'source-v1', trackId: 'video', atMs: 500 });
    let finish: (value: { ok: true; value: readonly unknown[] }) => void = () => undefined;
    api.reaAnalysisPrepareImport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => button('Import reviewed original ranges').click());
    await act(async () => { root.render(createElement(ReaVideoAnalysisWorkspace, { projectId: 'other', sourceEpoch: 'other-v1', assets: [asset], trackId: 'other-track', atMs: 0, onImportOperations })); });
    await act(async () => { finish({ ok: true, value: [{ action: 'clip.add' }] }); });
    expect(onImportOperations).toHaveBeenCalledOnce();
    expect(api.reaAnalysisCancel).toHaveBeenCalledWith({ jobId: 'job' });
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); }
});
