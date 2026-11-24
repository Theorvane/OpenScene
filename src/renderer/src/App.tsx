import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import type { AgentChatHistoryEntry } from '../../shared/agentChat';
import type { EditAgentProjectContext } from '../../shared/editAgentContext';
import type { AgentChatRestoreRequest } from './AgentChatContext';
import { AppShell } from './AppShell';
import { FirstRunOnboarding } from './FirstRunOnboarding';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { ProjectsPage } from './ProjectsPage';
import { SettingsWorkspace } from './SettingsWorkspace';
import { popPageHistory, pushPageHistory } from './appNavigationHistory';
import type { AppPageId } from './appPages';
import { APP_PAGE_BY_ID, getDefaultAppPageId, isProjectRequiredPageId, isWorkspacePageId } from './appPages';
import type { AppWorkspaceId } from './appWorkspaces';
import { APP_WORKSPACES, getDefaultAppWorkspaceId } from './appWorkspaces';
import { TimelineEditor } from './editor/TimelineEditor';
import { useTimelineEditor } from './editor/useTimelineEditor';
import { readFirstRunOnboardingCompletion, resetFirstRunOnboardingCompletion, writeFirstRunOnboardingCompletion } from './firstRunOnboardingPreference';
import { closeProjectTab, openProjectTab, pruneProjectTabs, type ProjectTab } from './projectTabs';

const [EDIT_WORKSPACE] = APP_WORKSPACES;

export function App(): ReactElement {
  const editor = useTimelineEditor();
  const [activePageId, setActivePageId] = useState<AppPageId>(() => getDefaultAppPageId());
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<AppWorkspaceId>(() => getDefaultAppWorkspaceId());
  const [showFirstRunOnboarding, setShowFirstRunOnboarding] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !readFirstRunOnboardingCompletion(window.localStorage).completed;
  });
  const pagePanelRefs = useRef<Partial<Record<AppPageId, HTMLElement>>>({});
  const pendingFocusPageRef = useRef<AppPageId | null>(null);
  const [chatHistory, setChatHistory] = useState<readonly AgentChatHistoryEntry[]>([]);
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
    // Stage flow guard: Home (Menu) and workspaces need an active project,
    // so project-less navigation lands on Projects instead.
    if (isProjectRequiredPageId(pageId) && !hasActiveProject) {
      navigateToPage('projects');
      return;
    }

    navigateToPage(pageId);
  }, [hasActiveProject, navigateToPage]);


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
    // project-required page, fall back to the Projects stage.
    if (hasActiveProject || !isProjectRequiredPageId(activePageId)) return;

    navigateToPage('projects');
  }, [activePageId, hasActiveProject, navigateToPage]);

  useEffect(() => {
    // Refresh the home screen chat history whenever Projects is shown (and as
    // the known project list changes underneath it).
    if (activePageId !== 'projects') return;
    let cancelled = false;
    void window.videoTool.agentChatHistoryList().then((response) => {
      if (cancelled || !response.ok) return;
      setChatHistory(response.value);
    });
    return () => {
      cancelled = true;
    };
  }, [activePageId, editor.projects]);

  const removeProject = useCallback(async (projectId: string): Promise<void> => {
    // Removing the open project has to clear the editor too, which
    // deleteCurrentProject already does; other rows only need the store call.
    if (editor.project?.id === projectId) {
      await editor.deleteCurrentProject();
    } else {
      const response = await window.videoTool.deleteProject({ projectId });
      if (!response.ok) return;
      await editor.refreshProjects();
    }
    const chats = await window.videoTool.agentChatHistoryList();
    if (chats.ok) setChatHistory(chats.value);
  }, [editor]);

  const deleteChatFromHistory = useCallback(async (entry: AgentChatHistoryEntry): Promise<void> => {
    const response = await window.videoTool.agentChatHistoryDelete({
      projectId: entry.projectId,
      conversationId: entry.conversationId
    });
    if (!response.ok) return;
    setChatHistory((current) => current.filter((item) =>
      item.projectId !== entry.projectId || item.conversationId !== entry.conversationId
    ));
  }, []);

  const openChatFromHistory = useCallback(async (entry: AgentChatHistoryEntry): Promise<void> => {
    const opened = await editor.openProject(entry.projectId);
    if (!opened) return;
    const conversation = await window.videoTool.agentChatHistoryGet({
      projectId: entry.projectId,
      conversationId: entry.conversationId
    });
    if (conversation.ok && conversation.value !== null) {
      setChatRestoreRequest({ conversationId: conversation.value.id, messages: conversation.value.messages });
    }
    // The project is open at this point, so enter the editor workspace
    // directly (the guarded setters still see the pre-open project state).
    setPageHistory((current) => pushPageHistory(current, activePageId));
    requestPageFocus(EDIT_WORKSPACE.id);
    setActiveWorkspaceId(EDIT_WORKSPACE.id);
    setActivePageId(EDIT_WORKSPACE.id);
  }, [activePageId, editor, requestPageFocus]);

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
    if (editor.project?.id === projectId) return;
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
      navigateToPage('projects');
      return;
    }
    await editor.openProject(next.activeId);
  }, [editor, navigateToPage, projectTabs]);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  return (
      <AppShell
        activePage={activePage}
        hasActiveProject={hasActiveProject}
        onPageChange={setActivePage}
        activeProjectContext={activeProjectContext}
        hasUnsavedTimeline={editor.hasUnsavedTimeline}
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
          <section
            aria-labelledby="projects-page-title"
            className="app-page app-page--projects"
            hidden={activePageId !== 'projects'}
            id="app-page-panel-projects"
            ref={setPagePanelRef('projects')}
            role="region"
            tabIndex={-1}
          >
            <ProjectsPage
              project={editor.project}
              projects={editor.projects}
              chats={chatHistory}
              onOpenProject={async (projectId) => {
                const opened = await editor.openProject(projectId);
                if (opened) { navigateToPage('edit'); }
              }}
              onOpenProjectFolder={async () => {
                const opened = await editor.openProjectFolder('editing');
                if (opened) { navigateToPage('edit'); }
              }}
              onOpenChat={openChatFromHistory}
              onRemoveProject={removeProject}
              onDeleteChat={deleteChatFromHistory}
              errorText={editor.statusMessage.tone === 'danger' ? editor.statusMessage.text : undefined}
              isBusy={editor.isBusy}
            />
          </section>
          <section className="app-stack local-edit-bay" hidden={!workspaceIsVisible}
            id={EDIT_WORKSPACE.panelId} ref={setPagePanelRef('edit')} role="region" aria-label="Editing workspace" tabIndex={-1}>
            <TimelineEditor editor={editor} onProjectSettings={() => setProjectSettingsOpen(true)} onOpenSettings={() => setActivePage('settings')} />
          </section>
          <section
            aria-labelledby="settings-title"
            className="app-page app-page--settings"
            data-cua-protected="settings"
            data-cua-protected-id="settings-page"
            hidden={activePageId !== 'settings'}
            id="app-page-panel-settings"
            ref={setPagePanelRef('settings')}
            role="region"
            tabIndex={-1}
          >
            <SettingsWorkspace onReplayFirstRunOnboarding={replayFirstRunOnboarding} />
          </section>
      </div>
      {projectSettingsOpen && editor.project !== null && (
        <ProjectSettingsDialog
          project={editor.project}
          summary={editor.projects.find((item) => item.id === editor.project?.id)}
          isBusy={editor.isBusy}
          onRename={editor.renameProject}
          onRemove={async () => {
            setProjectSettingsOpen(false);
            await removeProject(editor.project!.id);
          }}
          onClose={() => setProjectSettingsOpen(false)}
        />
      )}
      {showFirstRunOnboarding && <FirstRunOnboarding onComplete={completeFirstRunOnboarding} />}
      </AppShell>
  );
}
