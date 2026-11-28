import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import type { EditAgentProjectContext } from '../../shared/editAgentContext';
import type { AgentChatRestoreRequest } from './AgentChatContext';
import { AppShell } from './AppShell';
import { ProjectSidebar } from './ProjectSidebar';
import { VideoResultsList } from './editor/VideoResultsList';
import { FirstRunOnboarding } from './FirstRunOnboarding';
import { SettingsWorkspace } from './SettingsWorkspace';
import { popPageHistory, pushPageHistory } from './appNavigationHistory';
import type { AppPageId } from './appPages';
import { APP_PAGE_BY_ID, getDefaultAppPageId, isProjectRequiredPageId, isWorkspacePageId } from './appPages';
import type { AppWorkspaceId } from './appWorkspaces';
import { APP_WORKSPACES, getDefaultAppWorkspaceId } from './appWorkspaces';
import { TimelineEditor, type EditorViewMode } from './editor/TimelineEditor';
import { useTimelineEditor } from './editor/useTimelineEditor';
import { readFirstRunOnboardingCompletion, resetFirstRunOnboardingCompletion, writeFirstRunOnboardingCompletion } from './firstRunOnboardingPreference';
import { closeProjectTab, openProjectTab, pruneProjectTabs, type ProjectTab } from './projectTabs';

const [EDIT_WORKSPACE] = APP_WORKSPACES;

export function App(): ReactElement {
  const editor = useTimelineEditor();
  const [editorView, setEditorView] = useState<EditorViewMode>('shorts');
  const [sourcePreview, setSourcePreview] = useState(false);
  const [navigationError, setNavigationError] = useState('');
  useEffect(() => setSourcePreview(false), [editor.project?.id]);
  const projectPickerPending = useRef(false);
  const [activePageId, setActivePageId] = useState<AppPageId>(() => getDefaultAppPageId());
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<AppWorkspaceId>(() => getDefaultAppWorkspaceId());
  const [showFirstRunOnboarding, setShowFirstRunOnboarding] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !readFirstRunOnboardingCompletion(window.localStorage).completed;
  });
  const pagePanelRefs = useRef<Partial<Record<AppPageId, HTMLElement>>>({});
  const pendingFocusPageRef = useRef<AppPageId | null>(null);
  const [chatRestoreRequest, setChatRestoreRequest] = useState<AgentChatRestoreRequest | null>(null);
  const [pageHistory, setPageHistory] = useState<readonly AppPageId[]>([]);
  const activePage = APP_PAGE_BY_ID[activePageId];
  const activeProjectContext = useMemo<EditAgentProjectContext | null>(() => {
    if (editor.project === null) return null;

    return {
      projectId: editor.project.id,
      name: editor.project.name,
      assetCount: editor.project.assets.length,
      trackCount: editor.project.timeline.tracks.length
    };
  }, [editor.project]);

  const setPagePanelRef = useCallback((pageId: AppPageId) => (element: HTMLElement | null): void => {
    if (element === null) {
      delete pagePanelRefs.current[pageId];
      return;
    }

    pagePanelRefs.current[pageId] = element;
  }, []);

  const focusPagePanel = useCallback((pageId: AppPageId): void => {
    window.requestAnimationFrame(() => {
      pagePanelRefs.current[pageId]?.focus();
    });
  }, []);

  const requestPageFocus = useCallback((pageId: AppPageId): void => {
    pendingFocusPageRef.current = pageId;
  }, []);

  const hasActiveProject = editor.project !== null;

  const navigateToPage = useCallback((pageId: AppPageId): void => {
    if (pageId === activePageId) {
      focusPagePanel(pageId);
      return;
    }

    setPageHistory((current) => pushPageHistory(current, activePageId));
    requestPageFocus(pageId);
    setActivePageId(pageId);
  }, [activePageId, focusPagePanel, requestPageFocus]);

  const navigateBack = useCallback((): void => {
    const { target, rest } = popPageHistory(pageHistory);
    if (target === null) return;
    setPageHistory(rest);
    // Same guard as forward navigation: a project-required page in history
    // becomes Projects when the project is gone.
    const resolved = isProjectRequiredPageId(target) && editor.project === null ? 'projects' : target;
    requestPageFocus(resolved);
    if (isWorkspacePageId(resolved)) setActiveWorkspaceId(resolved);
    setActivePageId(resolved);
  }, [editor.project, pageHistory, requestPageFocus]);

  const setActivePage = useCallback((pageId: AppPageId): void => {
    if (pageId === 'projects') {
      if (projectPickerPending.current) return;
      projectPickerPending.current = true;
      void (async () => {
        try {
          if (editor.hasUnsavedTimeline && !await editor.saveTimeline()) return;
          const opened = await editor.openProjectFolder('editing');
          if (opened) navigateToPage('edit');
        } finally { projectPickerPending.current = false; }
      })();
      return;
    }
    if (isProjectRequiredPageId(pageId) && !hasActiveProject) {
      navigateToPage('edit');
      return;
    }

    navigateToPage(pageId);
  }, [editor, hasActiveProject, navigateToPage]);


  const completeFirstRunOnboarding = useCallback((): void => {
    writeFirstRunOnboardingCompletion(window.localStorage);
    setShowFirstRunOnboarding(false);
  }, []);

  const replayFirstRunOnboarding = useCallback((): void => {
    resetFirstRunOnboardingCompletion(window.localStorage);
    setShowFirstRunOnboarding(true);
  }, []);

  useEffect(() => {
    const pendingFocusPageId = pendingFocusPageRef.current;
    if (pendingFocusPageId === null || pendingFocusPageId !== activePageId) return;

    pendingFocusPageRef.current = null;
    focusPagePanel(activePageId);
  }, [activePageId, focusPagePanel]);

  useEffect(() => {
    // If the active project disappears (deleted or failed to load) while on a
    // project-required page, keep the natural intake visible.
    if (hasActiveProject || !isProjectRequiredPageId(activePageId)) return;

    navigateToPage('edit');
  }, [activePageId, hasActiveProject, navigateToPage]);

  const removeProject = useCallback(async (projectId: string): Promise<boolean> => {
    // Removing the open project has to clear the editor too, which
    // deleteCurrentProject already does; other rows only need the store call.
    if (editor.project?.id === projectId) {
      return await editor.deleteCurrentProject();
    } else {
      const response = await window.videoTool.deleteProject({ projectId });
      if (!response.ok || !response.value.deleted) return false;
      await editor.refreshProjects();
      return true;
    }
  }, [editor]);

  const clearChatRestoreRequest = useCallback((): void => {
    setChatRestoreRequest(null);
  }, []);

  const workspaceIsVisible = isWorkspacePageId(activePageId);
  const [projectTabs, setProjectTabs] = useState<readonly ProjectTab[]>([]);

  // A project deleted from the list must not linger as an unopenable tab.
  useEffect(() => {
    setProjectTabs((current) => pruneProjectTabs(current, editor.projects.map((project) => project.id)));
  }, [editor.projects]);

  useEffect(() => {
    if (editor.project === null) return;
    setProjectTabs((current) => openProjectTab(current, { id: editor.project!.id, name: editor.project!.name }));
  }, [editor.project?.id, editor.project?.name]);

  /**
   * Tabs share one editor, so the timeline in memory belongs to whichever
   * project is open. Persist unsaved work before loading the next one rather
   * than dropping it on a tab click.
   */
  const selectProjectTab = useCallback(async (projectId: string): Promise<void> => {
    if (editor.project?.id === projectId) { navigateToPage('edit'); return; }
    if (editor.hasUnsavedTimeline && !await editor.saveTimeline()) return;
    const opened = await editor.openProject(projectId);
    if (opened) navigateToPage('edit');
  }, [editor, navigateToPage]);

  const closeProjectTabById = useCallback(async (projectId: string): Promise<void> => {
    const next = closeProjectTab(projectTabs, projectId, editor.project?.id ?? null);
    if (editor.project?.id === projectId && editor.hasUnsavedTimeline && !await editor.saveTimeline()) return;
    setProjectTabs(next.tabs);
    if (editor.project?.id !== projectId) return;
    if (next.activeId === null) {
      editor.closeProject();
      navigateToPage('edit');
      return;
    }
    await editor.openProject(next.activeId);
  }, [editor, navigateToPage, projectTabs]);
  return (
      <AppShell
        sidebar={<>
          <ProjectSidebar projects={editor.projects} activeProjectId={editor.project?.id ?? null} busy={editor.isBusy}
            onSelect={id => { void selectProjectTab(id); }} onOpen={() => setActivePage('projects')}
            onCreate={async name => { if (editor.hasUnsavedTimeline && !await editor.saveTimeline()) return false; const created = await editor.createProject(name); if (created) { setEditorView('shorts'); navigateToPage('edit'); } return created; }}
            onRename={async (id, name) => { if (id === editor.project?.id) return await editor.renameProject(name); const response = await window.videoTool.renameProject({ projectId: id, name }); if (!response.ok) return false; await editor.refreshProjects(); return true; }}
            onCloseProject={id => { void closeProjectTabById(id); }} onRemove={removeProject} />
          {editor.project && <VideoResultsList editor={editor} active={workspaceIsVisible} onSelectProject={id => { void selectProjectTab(id); }} onInspectAsset={id => { editor.setSelectedAssetId(id); setSourcePreview(true); navigateToPage('edit'); }} />}
        </>}
        inlineAgentChat={editorView === 'shorts'}
        activePage={activePage}
        hasActiveProject={hasActiveProject}
        onPageChange={setActivePage}
        activeProjectContext={activeProjectContext}
        hasUnsavedTimeline={editor.hasUnsavedTimeline}
        contentRevision={editor.contentRevision}
        contentFingerprint={editor.contentFingerprint}
        prepareAgentProject={() => editor.hasUnsavedTimeline ? editor.saveTimeline() : Promise.resolve(true)}
        studioLayout={false}
        projectTabs={projectTabs}
        activeProjectId={editor.project?.id ?? null}
        onSelectProjectTab={(projectId) => void selectProjectTab(projectId)}
        onCloseProjectTab={(projectId) => void closeProjectTabById(projectId)}
        chatRestoreRequest={chatRestoreRequest}
        onChatRestoreHandled={clearChatRestoreRequest}
        canNavigateBack={pageHistory.length > 0}
        onNavigateBack={navigateBack}
      >
      <div className="app-page-stack">
          {(navigationError || editor.statusMessage?.tone === 'danger' || editor.statusMessage?.tone === 'warning') && <p role="alert" className="desktop-navigation-error">{navigationError || editor.statusMessage.text}</p>}
          <section className="app-stack local-edit-bay" hidden={!workspaceIsVisible}
            id={EDIT_WORKSPACE.panelId} ref={setPagePanelRef('edit')} role="region" aria-label="Editing workspace" tabIndex={-1}>
            <TimelineEditor editor={editor} sourcePreview={sourcePreview} onSourcePreviewChange={setSourcePreview} editorView={editorView} onEditorViewChange={setEditorView} active={workspaceIsVisible} onOpenSettings={() => setActivePage('settings')}
              onProjects={() => setActivePage('projects')} onSelectProject={(id) => { void selectProjectTab(id); }} />
          </section>
          <section
            aria-labelledby="settings-title"
            className="app-page app-page--settings"
            hidden={activePageId !== 'settings'}
            id="app-page-panel-settings"
            ref={setPagePanelRef('settings')}
            role="region"
            tabIndex={-1}
          >
            <SettingsWorkspace onReplayFirstRunOnboarding={replayFirstRunOnboarding} />
          </section>
      </div>
      {showFirstRunOnboarding && <FirstRunOnboarding onComplete={completeFirstRunOnboarding} />}
      </AppShell>
  );
}
