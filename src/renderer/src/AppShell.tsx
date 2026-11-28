import { useState, type ReactElement, type ReactNode } from 'react';
import type { EditAgentProjectContext } from '../../shared/editAgentContext';
import { isWorkspacePageId, type AppPage, type AppPageId } from './appPages';
import { AgentChatPanel } from './AgentChatPanel';
import type { ProjectTab } from './projectTabs';
import { AgentChatProvider, useAgentChat, type AgentChatRestoreRequest } from './AgentChatContext';
import { ApplicationMenuProvider } from './ApplicationMenuContext';
import { ApplicationMenuBar } from './ApplicationMenuBar';
import './desktopNavigation.css';

type AppShellProps = {
  readonly inlineAgentChat?: boolean;
  readonly activePage: AppPage;
  readonly children: ReactNode;
  readonly sidebar?: ReactNode;
  readonly hasActiveProject: boolean;
  readonly onPageChange: (pageId: AppPageId) => void;
  readonly activeProjectContext: EditAgentProjectContext | null;
  readonly contentRevision?: number;
  readonly contentFingerprint?: string | null;
  readonly prepareAgentProject?: () => Promise<boolean>;
  readonly hasUnsavedTimeline?: boolean;
  readonly studioLayout?: boolean;
  readonly projectTabs?: readonly ProjectTab[];
  readonly activeProjectId?: string | null;
  readonly onSelectProjectTab?: (projectId: string) => void;
  readonly onCloseProjectTab?: (projectId: string) => void;
  readonly chatRestoreRequest?: AgentChatRestoreRequest | null;
  readonly onChatRestoreHandled?: () => void;
  readonly canNavigateBack?: boolean;
  readonly onNavigateBack?: () => void;
};

function AppShellContent({ activePage, children, sidebar, onPageChange, activeProjectContext, inlineAgentChat = false, hasUnsavedTimeline }: AppShellProps): ReactElement {
  const { isBusy } = useAgentChat();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const naturalVisible = inlineAgentChat && isWorkspacePageId(activePage.id);
  return <main className="app-shell desktop-shell app-shell--workspace" data-sidebar-open={sidebarOpen}>
    <header className="product-chrome desktop-shell__chrome" aria-label="Application chrome">
      <button type="button" className="desktop-icon-button" aria-label="프로젝트 사이드바 전환" title="프로젝트 사이드바" aria-controls="desktop-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(value => !value)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>
      </button>
      <ApplicationMenuBar editorActive={activePage.id === 'edit'} onProjects={() => onPageChange('projects')} onSettings={() => onPageChange('settings')} onToggleAssistant={() => {}} assistantVisible={naturalVisible} canToggleAssistant={false} />
      <span className="desktop-shell__title">{activePage.id === 'settings' ? '설정' : activeProjectContext?.name ?? 'OpenScene'}{hasUnsavedTimeline && activePage.id !== 'settings' ? ' ·' : ''}</span>
    </header>
    <div className="desktop-shell__layout">
      <aside id="desktop-sidebar" className="desktop-sidebar" aria-label="프로젝트 탐색" hidden={!sidebarOpen} inert={isBusy}>
        <div className="desktop-sidebar__scroll">{sidebar}</div>
        <button className="desktop-sidebar__settings" type="button" aria-current={activePage.id === 'settings' ? 'page' : undefined} onClick={() => onPageChange(activePage.id === 'settings' ? 'edit' : 'settings')}>{activePage.id === 'settings' ? '편집으로 돌아가기' : '설정'}</button>
      </aside>
      <div className={`desktop-shell__content${naturalVisible ? ' desktop-shell__content--natural' : ''}`}>
        <div className="desktop-shell__workspace" aria-busy={isBusy} inert={isBusy}>{children}</div>
        <div className="desktop-shell__chat" hidden={!naturalVisible}>
          <AgentChatPanel inline onOpenSettings={() => onPageChange('settings')} />
        </div>
      </div>
    </div>
  </main>;
}

export function AppShell(props: AppShellProps): ReactElement {
  return <AgentChatProvider activeProject={props.activeProjectContext} hasUnsavedTimeline={props.hasUnsavedTimeline ?? true}
    {...(props.prepareAgentProject === undefined ? {} : { prepareProject: props.prepareAgentProject })}
    restoreRequest={props.chatRestoreRequest ?? null} {...(props.onChatRestoreHandled === undefined ? {} : { onRestoreHandled: props.onChatRestoreHandled })}>
    <ApplicationMenuProvider><AppShellContent {...props} /></ApplicationMenuProvider>
  </AgentChatProvider>;
}
