import { describe, expect, it } from 'vitest';

import { APP_PAGE_BY_ID, APP_PAGE_IDS, APP_PAGES, getDefaultAppPageId, isProjectRequiredPageId, isWorkspacePageId } from '../src/renderer/src/appPages';
import { APP_WORKSPACE_IDS, APP_WORKSPACES, getDefaultAppWorkspaceId } from '../src/renderer/src/appWorkspaces';

describe('app workspaces', () => {
  it('returns a single editor workspace: voice and video generation are dock tabs, not pages', () => {
    const workspaces = APP_WORKSPACES;

    expect(APP_WORKSPACE_IDS).toEqual(['edit']);
    expect(getDefaultAppWorkspaceId()).toBe('edit');
    expect(workspaces.map((workspace) => workspace.id)).toEqual(APP_WORKSPACE_IDS);
    expect(workspaces.map((workspace) => workspace.label)).toEqual(['Editing']);
    expect(workspaces.map((workspace) => workspace.navId)).toEqual(['app-workspace-nav-edit']);
    expect(workspaces.map((workspace) => workspace.panelId)).toEqual(['app-workspace-panel-edit']);
    expect(workspaces.map((workspace) => workspace.statusLabel)).toEqual(['Local timeline']);
  });

  it('returns a stable page model with Editing as the initial page and Settings outside workspaces', () => {
    const pages = APP_PAGES;

    // The menu page is gone: workspace tabs replaced it.
    expect(APP_PAGE_IDS).toEqual(['projects', 'edit', 'settings']);
    expect(getDefaultAppPageId()).toBe('edit');
    expect(pages.map((page) => page.id)).toEqual(APP_PAGE_IDS);
    expect(pages.map((page) => page.label)).toEqual(['Projects', 'Editing', 'Settings']);
    expect(APP_PAGE_BY_ID.settings.panelId).toBe('app-page-panel-settings');
    expect(isWorkspacePageId('projects')).toBe(false);
    expect(isWorkspacePageId('edit')).toBe(true);
    expect(isWorkspacePageId('settings')).toBe(false);
  });

  it('allows the natural intake workspace before a project exists', () => {
    expect(isProjectRequiredPageId('edit')).toBe(false);
    expect(isProjectRequiredPageId('projects')).toBe(false);
    expect(isProjectRequiredPageId('settings')).toBe(false);
  });
});
