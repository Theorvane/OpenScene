// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';


let dispose = () => {};
beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
afterEach(() => { act(dispose); vi.restoreAllMocks(); });
it('plays and seeks the entire imported source, clears stale URLs on project change and surfaces load errors', async () => {
  const modulePath = '../src/renderer/src/editor/SourceMediaPreview';
  const { SourceMediaPreview } = await import(modulePath);
  const getAssetPlaybackUrl = vi.fn().mockResolvedValue({ ok: true, value: { url: 'asset://first' } });
  Object.assign(window, { videoTool: { getAssetPlaybackUrl } });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); dispose = () => { root.unmount(); container.remove(); };
  const assets = [{ id: 'a', kind: 'video' as const, displayName: 'Full take', metadata: {} }];
  await act(async () => root.render(createElement(SourceMediaPreview, { projectId: 'p', assets, selectedAssetId: 'a', active: true })));
  const video = container.querySelector('video')!;
  expect(video.controls).toBe(true);
  expect(video.getAttribute('src')).toBe('asset://first');
  Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
  act(() => video.dispatchEvent(new Event('loadedmetadata')));
  const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
  expect(slider.max).toBe('120000');
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '60000'); slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(video.currentTime).toBe(60);
  act(() => { video.currentTime = 80; video.dispatchEvent(new Event('timeupdate')); });
  expect(slider.value).toBe('80000');
  Object.defineProperty(video, 'paused', { configurable: true, value: false });
  await act(async () => root.render(createElement(SourceMediaPreview, { projectId: 'p', assets, selectedAssetId: 'a', active: false })));
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  act(() => video.dispatchEvent(new Event('error')));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('코덱');
  let resolveUrl!: (value: unknown) => void;
  getAssetPlaybackUrl.mockImplementation(() => new Promise(resolve => { resolveUrl = resolve; }));
  await act(async () => root.render(createElement(SourceMediaPreview, { projectId: 'other', assets, selectedAssetId: 'a', active: true })));
  expect(container.querySelector('video')?.getAttribute('src')).toBeFalsy();
  await act(async () => resolveUrl({ ok: false, error: { message: 'Missing file' } }));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Missing file');
});
