import { useState, type ReactElement, type ReactNode } from 'react';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '../ui';
import {
  formatTimecodeSec,
  type WorkspaceCandidateItem,
  type WorkspaceMode,
  type WorkspaceProjectSummary,
  type WorkspaceSafetyState,
  type WorkspaceTabMode
} from './workspaceTypes';

export interface WorkspaceShellProps {
  readonly mode: WorkspaceMode;
  readonly onModeChange: (mode: WorkspaceTabMode) => void;
  readonly projects: readonly WorkspaceProjectSummary[];
  readonly activeProjectId: string | null;
  readonly onSelectProject: (projectId: string) => void;
  readonly onNewVideo: () => void;
  readonly candidates?: readonly WorkspaceCandidateItem[];
  readonly showCandidateNavigation?: boolean;
  readonly activeCandidateId?: string | null;
  readonly onSelectCandidate?: (candidateId: string) => void;
  readonly safety: WorkspaceSafetyState;
  readonly canUndo?: boolean;
  readonly onUndo?: () => void;
  readonly canRedo?: boolean;
  readonly onRedo?: () => void;
  readonly onSave?: () => void;
  readonly saveScopeLabel?: string;
  readonly onOpenAssets?: () => void;
  readonly onOpenSettings?: () => void;
  readonly assetsDrawerContent?: ReactNode;
  readonly settingsDrawerContent?: ReactNode;
  readonly onDuplicateProject?: () => void;
  readonly onRevealExports?: () => void;
  readonly children: ReactNode;
  /** Keep a live editor mounted when only its presentation changes. */
  readonly persistentContent?: boolean;
  readonly videoList?: ReactNode;
  readonly showProjectIdentity?: boolean;
  readonly showSettingsShortcut?: boolean;
  readonly onProjectSettings?: (() => void) | undefined;
  readonly actions?: ReactNode;
  readonly showSidebar?: boolean;
  readonly showProjectMenu?: boolean;
}

function BrandMark(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M5.25 4.25L10 7L5.25 9.75V4.25Z" fill="currentColor" />
    </svg>
  );
}

function UndoIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M4.2 5.2H9.2C10.7 5.2 11.8 6.3 11.8 7.8C11.8 9.3 10.7 10.4 9.2 10.4H6.2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M5.7 3.4L3.7 5.2L5.7 7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="8" height="8" rx="1.25" fill="currentColor" />
    </svg>
  );
}

function FolderIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1.75 3.5C1.75 2.95 2.2 2.5 2.75 2.5H5.4L6.7 3.8H11.25C11.8 3.8 12.25 4.25 12.25 4.8V10.5C12.25 11.05 11.8 11.5 11.25 11.5H2.75C2.2 11.5 1.75 11.05 1.75 10.5V3.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function SlidersIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 4H12M2 7H12M2 10H12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="5" cy="4" r="1.3" fill="var(--os-ui-surface)" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="9.2" cy="7" r="1.3" fill="var(--os-ui-surface)" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="6.5" cy="10" r="1.3" fill="var(--os-ui-surface)" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function MoreIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="3" cy="7" r="1" fill="currentColor" />
      <circle cx="7" cy="7" r="1" fill="currentColor" />
      <circle cx="11" cy="7" r="1" fill="currentColor" />
    </svg>
  );
}

export function WorkspaceShell({
  activeCandidateId = null,
  activeProjectId,
  assetsDrawerContent,
  canUndo = false,
  candidates = [],
  children,
  mode,
  onDuplicateProject,
  onModeChange,
  onNewVideo,
  onOpenAssets,
  onOpenSettings,
  onRevealExports,
  onSave,
  onSelectCandidate,
  onSelectProject,
  onUndo,
  canRedo = false,
  onRedo,
  projects,
  persistentContent = false,
  videoList,
  showProjectIdentity = true,
  showSettingsShortcut = true,
  onProjectSettings,
  actions,
  showSidebar = true,
  showProjectMenu = true,
  safety,
  saveScopeLabel,
  showCandidateNavigation = true,
  settingsDrawerContent
}: WorkspaceShellProps): ReactElement {
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const projectDisplayName = activeProject?.name ?? '새 프로젝트';
  const activeTabValue = mode === 'intake' ? '' : mode;

  const handleOpenAssets = (): void => {
    if (assetsDrawerContent !== undefined) {
      setAssetsOpen(true);
    }
    onOpenAssets?.();
  };

  const handleOpenSettings = (): void => {
    if (settingsDrawerContent !== undefined) {
      setSettingsOpen(true);
    }
    onOpenSettings?.();
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tabs
        value={activeTabValue}
        onValueChange={(nextValue) => {
          if (nextValue === 'natural' || nextValue === 'precision' || nextValue === 'node') {
            onModeChange(nextValue);
          }
        }}
        className="os-ws-shell"
        data-workspace-mode={mode}
      >
        <header className="os-ws-header">
          <div className="os-ws-header__left">
            {showProjectIdentity && <>
            <span className="os-ws-brand">
              <BrandMark />
              <span>OpenScene</span>
            </span>
            <span className="os-ws-brand__divider" aria-hidden="true" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="os-ws-project-trigger"
                  data-testid="workspace-project-name"
                >
                  <span className="os-ui-truncate">{projectDisplayName}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {activeProject?.sourceFileName ?? projectDisplayName}
              </TooltipContent>
            </Tooltip>
            </>}
          </div>

          <div className="os-ws-header__center">
            <TabsList className="os-ws-mode-tabs__list" aria-label="작업 모드">
              <TabsTrigger className="os-ws-mode-tabs__trigger" value="natural" data-testid="mode-tab-natural">
                자연어
              </TabsTrigger>
              <TabsTrigger className="os-ws-mode-tabs__trigger" value="precision" data-testid="mode-tab-precision">
                정밀
              </TabsTrigger>
              <TabsTrigger className="os-ws-mode-tabs__trigger" value="node" data-testid="mode-tab-node">
                노드
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="os-ws-header__right">
            {showProjectMenu && <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="os-ws-header__btn"
                  aria-label="프로젝트 더보기"
                  data-testid="workspace-project-menu-trigger"
                >
                  <MoreIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>프로젝트 작업</DropdownMenuLabel>
                <DropdownMenuItem onSelect={onNewVideo}>새 영상 시작</DropdownMenuItem>
                {onProjectSettings && <DropdownMenuItem onSelect={onProjectSettings}>프로젝트 설정</DropdownMenuItem>}
                {onDuplicateProject !== undefined && (
                  <DropdownMenuItem onSelect={onDuplicateProject}>프로젝트 복제</DropdownMenuItem>
                )}
                {onRevealExports !== undefined && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={onRevealExports}>내보내기 폴더 열기</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>}

            <Button
              variant="ghost"
              size="sm"
              className="os-ws-header__btn"
              disabled={!canUndo || onUndo === undefined}
              onClick={onUndo}
              aria-label="실행 취소"
              data-testid="workspace-undo-btn"
            >
              <UndoIcon />
              <span>실행 취소</span>
            </Button>
            {onRedo && <Button variant="ghost" size="sm" disabled={!canRedo} onClick={onRedo} aria-label="다시 실행" data-testid="workspace-redo-btn">↪</Button>}

            <Button
              variant="primary"
              size="sm"
              className="os-ws-header__btn"
              loading={safety.saving === true}
              disabled={onSave === undefined}
              onClick={onSave}
              data-testid="workspace-save-btn"
            >
              저장
            </Button>
            {actions}

          </div>
        </header>

        <div className="os-ws-safety-strip" role="status" aria-live="polite" data-testid="workspace-safety-strip">
          <div className="os-ws-safety-strip__group">
            <span className="os-ws-safety-item">
              <span className={safety.sourcePreserved ? 'os-ws-dot os-ws-dot--ok' : 'os-ws-dot os-ws-dot--warn'} aria-hidden="true" />
              <span>{safety.sourcePreserved ? '원본 파일 보존됨' : '원본 확인 필요'}</span>
            </span>

            <span className="os-ws-safety-item">
              <span className={safety.dirty ? 'os-ws-dot os-ws-dot--warn' : 'os-ws-dot os-ws-dot--ok'} aria-hidden="true" />
              <span>{safety.saving === true ? '저장 중' : safety.dirty ? `${saveScopeLabel === undefined ? '' : `${saveScopeLabel} · `}저장되지 않은 변경 있음` : saveScopeLabel === undefined ? '모든 변경 저장됨' : `${saveScopeLabel} 저장됨`}</span>
            </span>

            {safety.pendingApprovalCount > 0 && (
              <span className="os-ws-safety-item os-ui-tabular-nums" data-testid="workspace-pending-approvals">
                <span className="os-ws-dot os-ws-dot--warn" aria-hidden="true" />
                <span>승인 대기 {safety.pendingApprovalCount}건</span>
              </span>
            )}
          </div>

        </div>

        <div className="os-ws-body">
          {showSidebar && <aside className="os-ws-sidebar" aria-label="프로젝트 및 후보 탐색">
            <ScrollArea className="os-ws-sidebar__scroll">
              <div className="os-ws-sidebar__inner">
                {videoList ?? <section className="os-ws-sidebar__section">
                  <div className="os-ws-sidebar__section-header">
                    <span className="os-ws-sidebar__heading">프로젝트</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onNewVideo}
                      data-testid="sidebar-new-video-btn"
                    >
                      + 새 영상
                    </Button>
                  </div>

                  {projects.length === 0 ? (
                    <div className="os-ws-sidebar__empty">아직 열린 프로젝트가 없습니다.</div>
                  ) : (
                    projects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        className="os-ws-sidebar__item"
                        data-selected={project.id === activeProjectId ? 'true' : 'false'}
                        data-testid={`sidebar-project-${project.id}`}
                        onClick={() => onSelectProject(project.id)}
                      >
                        <span className="os-ui-truncate">{project.name}</span>
                        {project.durationLabel !== undefined && (
                          <span className="os-ws-sidebar__meta">{project.durationLabel}</span>
                        )}
                      </button>
                    ))
                  )}
                </section>}

                {showCandidateNavigation && <section className="os-ws-sidebar__section">
                  <div className="os-ws-sidebar__section-header">
                    <span className="os-ws-sidebar__heading">쇼츠 후보</span>
                    <span className="os-ws-sidebar__meta">{candidates.length}</span>
                  </div>

                  {candidates.length === 0 ? (
                    <div className="os-ws-sidebar__empty">후보 구간이 아직 없습니다.</div>
                  ) : (
                    candidates.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        className="os-ws-sidebar__item"
                        data-selected={candidate.id === activeCandidateId ? 'true' : 'false'}
                        data-testid={`sidebar-candidate-${candidate.id}`}
                        onClick={() => onSelectCandidate?.(candidate.id)}
                      >
                        <span className="os-ui-truncate">
                          {candidate.index}. {candidate.title}
                        </span>
                        <span className="os-ws-sidebar__meta">{formatTimecodeSec(candidate.startSec)}</span>
                      </button>
                    ))
                  )}
                </section>}
              </div>
            </ScrollArea>

            <div className="os-ws-sidebar__footer">
              <Button
                variant="ghost"
                size="sm"
                className="os-ws-sidebar__footer-btn"
                onClick={handleOpenAssets}
                data-testid="sidebar-assets-btn"
              >
                <FolderIcon />
                <span>자산</span>
              </Button>
              {showSettingsShortcut && <Button
                variant="ghost"
                size="sm"
                className="os-ws-sidebar__footer-btn"
                onClick={handleOpenSettings}
                data-testid="sidebar-settings-btn"
              >
                <SlidersIcon />
                <span>설정 · Jev</span>
              </Button>}
            </div>
          </aside>}

          <main className="os-ws-main">
            {mode === 'intake' && children}
            {persistentContent && mode !== 'intake' && (
              <TabsContent value={mode} forceMount className="os-ws-tabpanel" data-testid={`mode-tabpanel-${mode}`}>
                {children}
              </TabsContent>
            )}
            {(['natural', 'precision', 'node'] as const).filter((tabMode) => !persistentContent || mode !== tabMode).map((tabMode) => (
              <TabsContent
                key={tabMode}
                value={tabMode}
                forceMount
                hidden={mode !== tabMode}
                className="os-ws-tabpanel"
                data-testid={`mode-tabpanel-${tabMode}`}
              >
                {!persistentContent && mode === tabMode ? children : null}
              </TabsContent>
            ))}
          </main>
        </div>

        {assetsDrawerContent !== undefined && (
          <Sheet open={assetsOpen} onOpenChange={setAssetsOpen}>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>프로젝트 자산</SheetTitle>
                <SheetDescription>가져온 원본 미디어와 오디오 파일을 관리합니다.</SheetDescription>
              </SheetHeader>
              {assetsDrawerContent}
            </SheetContent>
          </Sheet>
        )}

        {settingsDrawerContent !== undefined && (
          <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
            <SheetContent side="right" surfaceKind="settings">
              <SheetHeader>
                <SheetTitle>설정 · Jev</SheetTitle>
                <SheetDescription>로컬 모델, 전사 엔진, Jev 연결 설정을 관리합니다.</SheetDescription>
              </SheetHeader>
              {settingsDrawerContent}
            </SheetContent>
          </Sheet>
        )}
      </Tabs>
    </TooltipProvider>
  );
}
