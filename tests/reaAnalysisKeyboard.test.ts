// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
it('keeps region scroll keys native while actual timeline shortcuts, descendant controls, modifiers and IME retain their scope', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, 'videoTool', { configurable: true, value: { reaAnalysisRuntime: async () => ({ ok: true, value: { available: false } }) } });
  const hostPath = '../src/renderer/src/editor/ReaEditorAnalysisHost';
  const shortcutPath = '../src/renderer/src/editor/useTimelineShortcuts';
  const preferencesPath = '../src/renderer/src/editor/editorShortcuts';
  const { ReaEditorAnalysisHost } = await import(hostPath) as { ReaEditorAnalysisHost: ComponentType<Record<string, unknown>> };
  const { useTimelineShortcuts } = await import(shortcutPath) as { useTimelineShortcuts: (input: Record<string, unknown>) => void };
  const { EDITOR_SHORTCUT_DEFAULT_PREFERENCES } = await import(preferencesPath);
  const goToTimelineEnd = vi.fn();
  const undoTimeline = vi.fn();
  function Probe() {
    useTimelineShortcuts({ canSplit: false, isLocked: false, shortcutPreferences: EDITOR_SHORTCUT_DEFAULT_PREFERENCES, goToTimelineEnd, undoTimeline, goToTimelineStart: vi.fn(), stepPlayhead: vi.fn(), setIsPlaying: vi.fn() });
    return createElement(ReaEditorAnalysisHost, { locked: false, editor: { project: { id: 'qa', assets: [], timeline: { tracks: [] } }, contentRevision: 0, playheadMs: 0 } });
  }
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => container.querySelector('button')!.click());
    const region = container.querySelector<HTMLElement>('.rea-editor-host')!; region.focus();
    const reachedWindow: KeyboardEvent[] = [];
    const observe = (event: KeyboardEvent) => reachedWindow.push(event);
    window.addEventListener('keydown', observe);
    const send = (target: Element, key: string, options: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
      act(() => target.dispatchEvent(event)); return event;
    };
    try {
      for (const key of ['End', 'Home', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']) {
        const event = send(region, key);
        expect(event.defaultPrevented).toBe(false); // Native scroll default remains available.
        expect(reachedWindow).not.toContain(event);
      }
      expect(goToTimelineEnd).not.toHaveBeenCalled();
      for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { isComposing: true }]) {
        const event = send(region, 'End', options);
        expect(reachedWindow).toContain(event);
      }
      const priorUndo = undoTimeline.mock.calls.length;
      const ctrlUndo = send(region, 'z', { ctrlKey: true });
      const metaUndo = send(region, 'z', { metaKey: true });
      expect(reachedWindow).toContain(ctrlUndo); expect(reachedWindow).toContain(metaUndo);
      expect(undoTimeline.mock.calls.length).toBe(priorUndo + 1); // Existing platform primary modifier is unchanged.
      const select = container.querySelector('select')!;
      const descendant = send(select, 'End', { isComposing: true });
      expect(reachedWindow).toContain(descendant); expect(descendant.defaultPrevented).toBe(false);
      const beforeEnd = goToTimelineEnd.mock.calls.length;
      const buttonEvent = send(container.querySelector('button')!, 'End');
      expect(reachedWindow).toContain(buttonEvent);
      expect(goToTimelineEnd.mock.calls.length).toBe(beforeEnd + 1);
      const otherView = document.createElement('div'); container.append(otherView);
      send(otherView, 'End');
      expect(goToTimelineEnd.mock.calls.length).toBe(beforeEnd + 2);
      await act(async () => container.querySelector('button')!.click());
      send(region, 'End');
      expect(goToTimelineEnd.mock.calls.length).toBe(beforeEnd + 3);
    } finally { window.removeEventListener('keydown', observe); }
  } finally { await act(async () => root.unmount()); container.remove(); }
});
