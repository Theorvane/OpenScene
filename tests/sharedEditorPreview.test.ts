// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

vi.mock('../src/renderer/src/editor/ProgramMonitor', () => ({ ProgramMonitor: ({ editor }: { editor: { playheadMs: number } }) => createElement('video', { 'data-preview': 'edited', 'data-time': editor.playheadMs }) }));
vi.mock('../src/renderer/src/editor/SourceMediaPreview', () => ({ SourceMediaPreview: () => createElement('video', { 'data-preview': 'source' }) }));

it('keeps one edited preview and playhead when the editing presentation changes, with explicit source inspection', async () => {
  const path = '../src/renderer/src/editor/EditorPreview.tsx';
  const { EditorPreview } = await import(path) as { EditorPreview: ComponentType<Record<string, unknown>> };
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const doc = globalThis.document;
  const host = doc.createElement('div'); doc.body.appendChild(host); const root = createRoot(host);
  const editor = { project: { id: 'p', assets: [{ id: 'a', kind: 'video' }], timeline: { tracks: [{ clips: [{ id: 'c' }] }] } }, playheadMs: 1234, selectedAsset: { id: 'a' }, setIsPlaying: vi.fn() };
  try {
    await act(async () => root.render(createElement(EditorPreview, { editor, active: true })));
    const video = host.querySelector('video');
    await act(async () => root.render(createElement(EditorPreview, { editor: { ...editor, playheadMs: 2345 }, active: true })));
    expect(host.querySelectorAll('video')).toHaveLength(1);
    expect(host.querySelector('video')).toBe(video);
    expect(video?.getAttribute('data-time')).toBe('2345');
    await act(async () => (host.querySelector('[data-testid="preview-source"]') as HTMLButtonElement).click());
    expect(host.querySelector('[data-preview="source"]')).not.toBeNull();
    expect(host.querySelector('[data-preview="edited"]')).toBeNull();
    expect(editor.setIsPlaying).toHaveBeenCalledWith(false);
    await act(async () => (host.querySelector('[data-testid="preview-edit"]') as HTMLButtonElement).click());
    expect(host.querySelector('[data-preview="edited"]')?.getAttribute('data-time')).toBe('2345');
  } finally { act(() => root.unmount()); host.remove(); }
});
