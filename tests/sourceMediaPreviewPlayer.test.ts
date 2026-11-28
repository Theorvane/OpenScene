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
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function(this: HTMLMediaElement) { this.dispatchEvent(new Event('pause')); });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); dispose = () => { root.unmount(); container.remove(); };
  const assets = [{ id: 'a', kind: 'video' as const, displayName: 'Full take', metadata: {} }];
  await act(async () => root.render(createElement(SourceMediaPreview, { projectId: 'p', assets, selectedAssetId: 'a', active: true })));
  const video = container.querySelector('video')!;
  expect(video.controls).toBe(false);

  expect(video.getAttribute('src')).toBe('asset://first');
  Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
  act(() => video.dispatchEvent(new Event('loadedmetadata')));
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function(this: HTMLMediaElement) { this.dispatchEvent(new Event('play')); });
  const playButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="재생"]');
  await act(async () => playButton()!.click());
  expect(play).toHaveBeenCalledOnce();
  expect(container.querySelector('button[aria-label="일시정지"]')).not.toBeNull();
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="일시정지"]')!.click());
  expect(playButton()).not.toBeNull();
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="음소거"]')!.click());
  expect(video.muted).toBe(true);
  expect(container.querySelectorAll('[data-source-track]')).toHaveLength(3);

  const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
  expect(slider.max).toBe('120000');
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '60000'); slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(video.currentTime).toBe(60);
  act(() => { video.currentTime = 80; video.dispatchEvent(new Event('timeupdate')); });
  expect(slider.value).toBe('80000');
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="5초 뒤로"]')!.click());
  expect(video.currentTime).toBe(75);
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="5초 앞으로"]')!.click());
  expect(video.currentTime).toBe(80);
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="끝으로"]')!.click());
  expect(video.currentTime).toBe(120);
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="5초 앞으로"]')!.click());
  expect(video.currentTime).toBe(120);
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="처음으로"]')!.click());
  expect(video.currentTime).toBe(0);
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

it('shows actual timed subtitle clips, seeks them on the source clock, and hides captions from another project', async () => {
  const path = '../src/renderer/src/editor/SourceMediaPreview';
  const { SourceMediaPreview } = await import(path);
  Object.assign(window, { videoTool: { getAssetPlaybackUrl: vi.fn().mockResolvedValue({ ok: true, value: { url: 'asset://take' } }) } });
  const container = document.createElement('div'); const root = createRoot(container);
  dispose = () => root.unmount();
  const assets = [{ id: 'take', kind: 'video', displayName: 'Take', metadata: { durationMs: 10000 } }];
  const captionSource = { projectId: 'p', assetId: 'take', captions: [{ id: 'cue', text: 'A real caption', startMs: 2000, endMs: 4000 }] };
  await act(async () => root.render(createElement(SourceMediaPreview, { projectId: 'p', assets, selectedAssetId: 'take', active: true, captionSource })));
  const video = container.querySelector('video')!;
  Object.defineProperty(video, 'audioTracks', { value: { length: 1 } });
  act(() => video.dispatchEvent(new Event('loadedmetadata')));
  expect(container.querySelectorAll('[data-source-track="audio"] button')).toHaveLength(1);
  const caption = container.querySelector<HTMLButtonElement>('[data-source-track="subtitle"] button')!;
  expect(caption.textContent).toBe('A real caption');
  expect(caption.style.left).toBe('20%'); expect(caption.style.width).toBe('20%');
  act(() => caption.click()); expect(video.currentTime).toBe(2);
  await act(async () => root.render(createElement(SourceMediaPreview, { projectId: 'other', assets, selectedAssetId: 'take', active: true, captionSource })));
  expect(container.querySelector('[data-source-track="subtitle"] button')).toBeNull();
});
