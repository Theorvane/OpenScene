// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ editor: { project: null, projects: [] } }));
vi.mock('../src/renderer/src/editor/useTimelineEditor', () => ({ useTimelineEditor: () => fixture.editor }));
vi.mock('../src/renderer/src/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => createElement('div', {}, children) }));
vi.mock('../src/renderer/src/editor/TimelineEditor', () => ({ TimelineEditor: () => createElement('div', { 'data-testid': 'natural-intake' }) }));
vi.mock('../src/renderer/src/SettingsWorkspace', () => ({ SettingsWorkspace: () => null }));
vi.mock('../src/renderer/src/FirstRunOnboarding', () => ({ FirstRunOnboarding: () => null }));
vi.mock('../src/renderer/src/ProjectSettingsDialog', () => ({ ProjectSettingsDialog: () => null }));
it('opens editing immediately without a project or a project-selection screen', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const path = '../src/renderer/src/App';
  const { App } = await import(path);
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(App)));
    expect(container.querySelector('[data-testid="natural-intake"]')?.closest('[hidden]')).toBeNull();
    expect(container.querySelector('#app-page-panel-projects')).toBeNull();
  } finally { act(() => root.unmount()); }
});
