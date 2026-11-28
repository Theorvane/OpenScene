// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => { const open = vi.fn(); return { open, editor: { project: null, projects: [], hasUnsavedTimeline: false, openProjectFolder: open } }; });
vi.mock('../src/renderer/src/editor/useTimelineEditor', () => ({ useTimelineEditor: () => fixture.editor }));
vi.mock('../src/renderer/src/AppShell', () => ({ AppShell: ({ children, onPageChange }: { children: ReactNode; onPageChange: (page: string) => void }) => createElement('div', {}, createElement('button', { onClick: () => onPageChange('projects') }, 'Open'), children) }));
vi.mock('../src/renderer/src/editor/TimelineEditor', () => ({ TimelineEditor: () => null }));
vi.mock('../src/renderer/src/SettingsWorkspace', () => ({ SettingsWorkspace: () => null }));
vi.mock('../src/renderer/src/FirstRunOnboarding', () => ({ FirstRunOnboarding: () => null }));
vi.mock('../src/renderer/src/ProjectSettingsDialog', () => ({ ProjectSettingsDialog: () => null }));
it('opens only one project picker when the same action is invoked again before the first dialog closes', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let finish!: (value: boolean) => void;
  fixture.open.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const path = '../src/renderer/src/App'; const { App } = await import(path);
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(App)));
    act(() => { host.querySelector('button')!.click(); host.querySelector('button')!.click(); });
    expect(fixture.open).toHaveBeenCalledOnce();
  } finally { await act(async () => { finish(false); }); act(() => root.unmount()); }
});
