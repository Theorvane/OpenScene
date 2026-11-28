// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ReaGenerationPlan } from '../src/shared/reaGeneration';

it('mounts review preparation with no automatic credential read, network submission or save and retires late results', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const componentPath = '../src/renderer/components/workspace/ReaGenerationPanel';
  const { ReaGenerationPanel } = await import(componentPath) as { ReaGenerationPanel: ComponentType<Record<string, unknown>> };
  let finish!: (value: unknown) => void;
  const api = {
    reaGenerationStatus: vi.fn(), reaGenerationSetCredential: vi.fn(),
    reaGenerationPrepare: vi.fn((_plan: ReaGenerationPlan) => new Promise(resolve => { finish = resolve; })),
    reaGenerationCancel: vi.fn(async () => ({ ok: true })), saveTimeline: vi.fn(),
    reaGenerationSubmit: vi.fn(), getProviderCredentials: vi.fn()
  };
  Object.defineProperty(window, 'videoTool', { configurable: true, value: api });
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const props = { projectId: 'p', sourceEpoch: 'e1', assets: [{ id: 'source', kind: 'video', displayName: 'Original', metadata: { durationMs: 5000 } }] };
  const button = (text: string) => [...node.querySelectorAll('button')].find(b => b.textContent === text)!;
  try {
    await act(async () => root.render(createElement(ReaGenerationPanel, props)));
    expect(api.reaGenerationStatus).not.toHaveBeenCalled(); expect(api.getProviderCredentials).not.toHaveBeenCalled();
    expect(node.textContent).toContain('Paid execution: false');
    await act(async () => { const select = node.querySelector('select')!; select.value = 'source'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => {
      const textarea = node.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Paper boat');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Prepare one-shot approval review').click());
    expect(api.reaGenerationPrepare).toHaveBeenCalledOnce();
    const p = api.reaGenerationPrepare.mock.calls[0]![0] as ReaGenerationPlan;
    expect(p).toMatchObject({ projectId: 'p', sourceEpoch: 'e1', prompt: 'Paper boat', manifest: { sourceVideo: false, sourceAudio: false, firstFrame: false } });
    await act(async () => root.render(createElement(ReaGenerationPanel, { ...props, projectId: 'other', sourceEpoch: 'e2' })));
    await act(async () => finish({ ok: true, value: { plan: p, receipt: { id: 'job', state: 'awaiting-approval', planHash: 'a'.repeat(64) }, approval: 'one-use' } }));
    expect(node.textContent).not.toContain('a'.repeat(64));
    expect(api.reaGenerationCancel).toHaveBeenCalledWith({ id: 'job', projectId: 'p' });
    expect(api.reaGenerationSubmit).not.toHaveBeenCalled(); expect(api.saveTimeline).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); node.remove(); }
});
