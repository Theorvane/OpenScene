import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { EditorWorkspace } from '../../../../external/opencut/apps/web/src/components/editor/editor-workspace';
import { EditorHeader } from './EditorWorkbenchHeader';

import { AssetMetadataProbeHost } from './AssetMetadataProbeHost';
import { EDITOR_INSPECTOR_DOCK_TAB_IDS, getDefaultEditorDockTabs, getDefaultEditorLeftDockTabId } from './dockTabs';
import type { EditorLeftDockTabId } from './dockTabs';
import { EditorFloatingPanelFrame } from './EditorFloatingPanelFrame';
import {
  bringEditorFloatingPanelToFront,
  clampEditorInspectorWidth,
  clampEditorLeftDockWidth,
  clampEditorProgramPercent,
  EDITOR_LAYOUT_FLOATING_PRESETS,
  moveEditorFloatingPanel,
  resetEditorLayoutPreference,
  setEditorFloatingPanelMode,
  setEditorFloatingPanels,
  setEditorInspectorPlacement,
  toggleEditorInspector,
  toggleEditorLeftDock,
  type EditorFloatingPanel,
  type EditorFloatingPanelId,
  type EditorFloatingPresetId,
  type EditorLayoutPreference
} from './editorLayoutPreferences';
import { ExportPanel } from './ExportPanel';
import { InspectorPanel } from './InspectorPanel';
import { ProgramMonitor } from './ProgramMonitor';
import { ProjectRail } from './ProjectRail';
import { TimelineCanvas } from './TimelineCanvas';
import { TimelineEditorLeftDock } from './TimelineEditorLeftDock';
import { EditorInspectorSplitter, EditorLeftDockSplitter, EditorProgramSplitter } from './TimelineEditorLayoutControls';
import { useEditorLayoutPreference } from './useEditorLayoutPreference';
import { useEditorNativeMenuCommands } from './useEditorNativeMenuCommands';
import { useEditorShortcutPreference } from './useEditorShortcutPreference';
import type { TimelineEditorController } from './useTimelineEditor';
import { useTimelineShortcuts } from './useTimelineShortcuts';
import { useAgentChat } from '../AgentChatContext';
import { useCuaActing } from '../cua/useCuaOverlay';
import { useTheme } from '../ThemeProvider';
import { THEME_PRESETS, type ThemePresetId } from '../theme';
import type { TabDefinition } from '../ui';
import { VideoConnectionCanvas } from './VideoConnectionCanvas';
import { ShortsReviewWorkspace, type ShortsOpenEditorRequest } from './shorts/ShortsReviewWorkspace';
import { writeExportFramePreference } from './exportFramePreference';
import './videoCanvas.css';
import './editorWorkbench.css';

export type InspectorTabId = (typeof EDITOR_INSPECTOR_DOCK_TAB_IDS)[number];

type EditorViewMode = 'timeline' | 'canvas' | 'shorts';

type TimelineEditorProps = {
  readonly editor: TimelineEditorController;
  readonly onProjectSettings?: () => void;
  readonly onOpenSettings?: () => void;
};

const INSPECTOR_TAB_LABELS: Readonly<Record<InspectorTabId, string>> = {
  asset: 'Asset',
  selection: 'Selection'
};

function getInspectorTabs(editor: TimelineEditorController): readonly TabDefinition<InspectorTabId>[] {
  const dockTabs = editor.project === null ? null : getDefaultEditorDockTabs(editor.project).inspector;

  return EDITOR_INSPECTOR_DOCK_TAB_IDS.map((tabId) => {
    const dockTab = dockTabs?.find((tab) => tab.id === tabId);
    const label = tabId === 'selection' ? 'Clip' : dockTab?.label ?? INSPECTOR_TAB_LABELS[tabId];
    // Without a project there is nothing to inspect at all.
    const disabled = editor.project === null ? true : dockTab?.disabled === true;

    return disabled ? { id: tabId, label, disabled: true } : { id: tabId, label };
  });
}

type InspectorIdentityInput = {
  readonly selectedAssetId: string;
  readonly selectedClipId: string;
};

type EditorWorkspaceStyle = CSSProperties & {
  readonly '--editor-left-dock-width': string;
  readonly '--editor-inspector-width': string;
  readonly '--editor-program-percent': string;
  readonly '--editor-timeline-percent': string;
};

const FLOATING_PANEL_LABELS: Readonly<Record<EditorFloatingPanelId, string>> = {
  export: 'Export',
  inspector: 'Inspector',
  program: 'Program Monitor',
  project: 'Project Dock'
};

type FloatingPanelRenderInput = {
  readonly child: ReactNode;
  readonly floatingPanel: EditorFloatingPanel;
  readonly panelId: EditorFloatingPanelId;
};

function getDefaultInspectorTabId({ selectedAssetId, selectedClipId }: InspectorIdentityInput): InspectorTabId {
  if (selectedAssetId.length > 0 && selectedClipId.length === 0) return 'asset';
  return 'selection';
}

export function TimelineEditor({ editor, onProjectSettings, onOpenSettings }: TimelineEditorProps): ReactElement {
  const [editorView, setEditorView] = useState<EditorViewMode>(() => {
    try {
      const stored = localStorage.getItem('openvideo-editor-view');
      return stored === 'canvas' || stored === 'shorts' ? stored : 'timeline';
    } catch {
      return 'timeline';
    }
  });
  const [shortsReturnContext, setShortsReturnContext] = useState<ShortsOpenEditorRequest | null>(null);
  const [restoredShortsTarget, setRestoredShortsTarget] = useState<{
    readonly jobId: string;
    readonly candidateId: string;
    readonly token: number;
  } | null>(null);
  const canvasMode = editorView === 'canvas';
  const shortsMode = editorView === 'shorts';
  const fullStageMode = canvasMode || shortsMode;
  useEffect(() => {
    const closeOutside = (event: globalThis.PointerEvent) => {
      document.querySelectorAll<HTMLDetailsElement>('details.workbench-menu[open]').forEach(menu => {
        if (!menu.contains(event.target as Node)) menu.open = false;
      });
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      document.querySelectorAll<HTMLDetailsElement>('details.workbench-menu[open]').forEach(menu => {
        if (menu.contains(document.activeElement)) menu.querySelector('summary')?.focus();
        menu.open = false;
      });
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, []);
  const { isBusy: isAgentBusy } = useAgentChat();
  const isCuaActing = useCuaActing();
  const { mode: themeMode, preset, setPreset, toggleTheme } = useTheme();
  const [leftDockTabId, setLeftDockTabId] = useState<EditorLeftDockTabId>('project');
  const [inspectorTabId, setInspectorTabId] = useState<InspectorTabId>('selection');
  const { layoutPreference, updateLayoutPreference } = useEditorLayoutPreference();
  const { shortcutPreferences } = useEditorShortcutPreference();
  const selectEditorView = (view: EditorViewMode): void => {
    editor.setIsPlaying(false);
    setEditorView(view);
    try {
      localStorage.setItem('openvideo-editor-view', view);
    } catch {
      // The selected view remains usable when browser storage is unavailable.
    }
  };
  const openMaterializedShortInEditor = async (request: ShortsOpenEditorRequest): Promise<void> => {
    if (editor.hasUnsavedTimeline && !(await editor.saveTimeline())) return;
    // Refresh the project list before opening the newly materialized project so
    // App.tsx's tab pruning sees it as an existing project.
    await editor.refreshProjects();
    writeExportFramePreference(request.resultProjectId, 'portrait');
    const opened = await editor.openProject(request.resultProjectId);
    if (!opened) return;
    setShortsReturnContext(request);
    selectEditorView('timeline');
  };
  const returnToShortsReview = async (): Promise<void> => {
    if (shortsReturnContext === null) return;
    if (editor.hasUnsavedTimeline && !(await editor.saveTimeline())) return;
    const context = shortsReturnContext;
    const opened = await editor.openProject(context.sourceProjectId);
    if (!opened) return;
    setShortsReturnContext(null);
    setRestoredShortsTarget((current) => ({
      jobId: context.jobId,
      candidateId: context.candidateId,
      token: (current?.token ?? 0) + 1
    }));
    selectEditorView('shorts');
  };
  const inspectorTabs = getInspectorTabs(editor);
  const projectIdentity = editor.project?.id ?? '';
  const selectedAssetIdentity = editor.selectedAsset?.id ?? '';
  const selectedClipIdentity = editor.selectedClip?.clip.id ?? '';

  useEffect(() => {
    setInspectorTabId(getDefaultInspectorTabId({ selectedAssetId: selectedAssetIdentity, selectedClipId: selectedClipIdentity }));
  }, [projectIdentity, selectedAssetIdentity, selectedClipIdentity]);

  useEffect(() => {
    setLeftDockTabId(getDefaultEditorLeftDockTabId({ hasProject: projectIdentity.length > 0, selectedAssetId: '' }));
  }, [projectIdentity]);

  const setProgramPercent = (programPercent: number): void => {
    updateLayoutPreference((currentPreference) => ({ ...currentPreference, programPercent: clampEditorProgramPercent(programPercent) }));
  };

  const setLeftDockWidth = (leftDockWidth: number): void => {
    updateLayoutPreference((currentPreference) => ({ ...currentPreference, leftDockWidth: clampEditorLeftDockWidth(leftDockWidth) }));
  };

  const setInspectorWidth = (inspectorWidth: number): void => {
    updateLayoutPreference((currentPreference) => ({ ...currentPreference, inspectorWidth: clampEditorInspectorWidth(inspectorWidth) }));
  };

  const workspaceClassName = [
    canvasMode ? 'oc-editor-host--canvas' : null,
    shortsMode ? 'oc-editor-host--shorts' : null,
    fullStageMode || !layoutPreference.leftDockVisible ? 'oc-editor-host--left-hidden' : null,
    layoutPreference.inspectorVisible ? null : 'oc-editor-host--inspector-hidden',
    `oc-editor-host--inspector-${layoutPreference.inspectorPlacement}`
  ].filter((className): className is string => className !== null).join(' ');

  const workspaceStyle: EditorWorkspaceStyle = {
    '--editor-left-dock-width': `${layoutPreference.leftDockWidth}px`,
    '--editor-inspector-width': `${layoutPreference.inspectorWidth}px`,
    '--editor-program-percent': `${layoutPreference.programPercent}fr`,
    '--editor-timeline-percent': `${100 - layoutPreference.programPercent}fr`
  };

  const inspectorPanel = <InspectorPanel activeTabId={inspectorTabId} editor={editor} tabs={inspectorTabs} onActiveTabChange={setInspectorTabId} />;
  const dockedInspectorVisible = layoutPreference.inspectorVisible && layoutPreference.inspectorPlacement !== 'floating';
  const floatingProjectVisible = layoutPreference.floatingPanels.project.floating;
  const floatingProgramVisible = layoutPreference.floatingPanels.program.floating;
  const floatingInspectorVisible = layoutPreference.inspectorVisible && layoutPreference.floatingPanels.inspector.floating;
  const floatingExportVisible = layoutPreference.floatingPanels.export.floating;
  const resetLayout = (): void => updateLayoutPreference(() => resetEditorLayoutPreference());
  const toggleInspector = (): void => updateLayoutPreference(toggleEditorInspector);
  const toggleLeftDock = (): void => updateLayoutPreference(toggleEditorLeftDock);
  const setFloatingPanelMode = (panelId: EditorFloatingPanelId, floating: boolean): void => {
    updateLayoutPreference((currentPreference) => setEditorFloatingPanelMode(currentPreference, panelId, floating));
  };
  const setInspectorPlacement = (placement: EditorLayoutPreference['inspectorPlacement']): void => {
    updateLayoutPreference((currentPreference) => setEditorInspectorPlacement(currentPreference, placement));
  };
  const applyFloatingPreset = (presetId: EditorFloatingPresetId): void => {
    updateLayoutPreference((currentPreference) => setEditorFloatingPanels(currentPreference, EDITOR_LAYOUT_FLOATING_PRESETS[presetId].floatingPanels));
  };
  const focusFloatingPanel = (panelId: EditorFloatingPanelId): void => {
    updateLayoutPreference((currentPreference) => bringEditorFloatingPanelToFront(currentPreference, panelId));
  };
  const moveFloatingPanel = (panelId: EditorFloatingPanelId, panel: EditorFloatingPanel): void => {
    updateLayoutPreference((currentPreference) => moveEditorFloatingPanel(currentPreference, panelId, panel));
  };
  const renderFloatingPanel = ({ child, floatingPanel, panelId }: FloatingPanelRenderInput): ReactElement => (
    <EditorFloatingPanelFrame
      key={panelId}
      label={FLOATING_PANEL_LABELS[panelId]}
      panel={floatingPanel}
      panelId={panelId}
      onClose={(id) => setFloatingPanelMode(id, false)}
      onFocusPanel={focusFloatingPanel}
      onMovePanel={moveFloatingPanel}
    >
      {child}
    </EditorFloatingPanelFrame>
  );

  useTimelineShortcuts({
    canSplit: editor.selectedClip !== null,
    isLocked: isAgentBusy,
    cuaActing: isCuaActing,
    clearSelection: editor.clearSelection,
    deleteSelectedClip: editor.deleteSelectedClip,
    duplicateSelectedClip: editor.duplicateSelectedClip,
    goToTimelineEnd: editor.goToTimelineEnd,
    goToTimelineStart: editor.goToTimelineStart,
    moveSelectedClip: editor.moveSelectedClip,
    saveTimeline: () => { void editor.saveTimeline(); },
    stepPlayhead: editor.stepPlayhead,
    redoTimeline: editor.redoTimeline,
    resetLayout,
    selectAllClips: editor.selectAllClips,
    setIsPlaying: editor.setIsPlaying,
    shortcutPreferences,
    splitAtPlayhead: editor.splitAtPlayhead,
    toggleInspector,
    toggleLeftDock,
    undoTimeline: editor.undoTimeline
  });

  useEditorNativeMenuCommands({
    editor,
    canvasMode,
    shortcutPreferences,
    isAgentBusy,
    layoutPreference,
    onApplyFloatingPreset: applyFloatingPreset,
    onResetLayout: resetLayout,
    onSetFloatingPanelMode: setFloatingPanelMode,
    onSetInspectorPlacement: setInspectorPlacement,
    onToggleInspector: toggleInspector,
    onToggleLeftDock: toggleLeftDock
  });

  return (
    <EditorWorkspace
      mode="host"
      className={workspaceClassName}
      style={workspaceStyle}
      labelledBy="timeline-editor-title"
      header={<EditorHeader
        brand="OpenScene"
        projectName={editor.project?.name ?? 'No project'}
        themeMode={themeMode}
        themePreset={preset}
        themeOptions={THEME_PRESETS}
        onThemeModeToggle={toggleTheme}
        onThemePresetChange={(next) => setPreset(next as ThemePresetId)}
        actions={<>
          <div className="editor-view-switch" role="group" aria-label="Editor mode">
            <button type="button" data-testid="editor-mode-timeline" aria-pressed={!fullStageMode} onClick={() => selectEditorView('timeline')}>Timeline</button>
            <button type="button" data-testid="editor-mode-canvas" aria-pressed={canvasMode} onClick={() => selectEditorView('canvas')}>Canvas</button>
            <button type="button" data-testid="editor-mode-shorts" aria-pressed={shortsMode} onClick={() => selectEditorView('shorts')}>Shorts</button>
          </div>
          <details className="workbench-menu">
            <summary>Project</summary>
            <div className="workbench-menu__popover">
              <button type="button" onClick={onProjectSettings}>Project settings</button>
              <button type="button" disabled={!editor.hasUnsavedTimeline || isAgentBusy || editor.isBusy} onClick={() => { void editor.saveTimeline(); }}>Save project</button>
            </div>
          </details>
          <details className="workbench-menu">
            <summary>View</summary>
            <div className="workbench-menu__popover">
              <span className="workbench-menu__label">WORKSPACE PANELS</span>
              <button type="button" disabled={fullStageMode} aria-pressed={layoutPreference.leftDockVisible} onClick={() => updateLayoutPreference(toggleEditorLeftDock)}>Media library {layoutPreference.leftDockVisible ? '✓' : ''}</button>
              <button type="button" disabled={fullStageMode} aria-pressed={layoutPreference.inspectorVisible} onClick={() => updateLayoutPreference(toggleEditorInspector)}>Inspector {layoutPreference.inspectorVisible ? '✓' : ''}</button>
              <button type="button" onClick={resetLayout}>Reset layout</button>
            </div>
          </details>
          <button
            className="oc-editor-host__save"
            data-testid="editor-save-btn"
            data-dirty={editor.hasUnsavedTimeline ? 'true' : 'false'}
            data-saving={editor.isSavingTimeline ? 'true' : 'false'}
            data-save-status={editor.timelineSaveStatus}
            data-save-error={editor.timelineSaveError ?? undefined}
            aria-busy={editor.isSavingTimeline}
            type="button"
            onClick={() => { void editor.saveTimeline(); }}
            disabled={editor.project === null || !editor.hasUnsavedTimeline || editor.isSavingTimeline}
          >
            {editor.isSavingTimeline ? 'Saving…' : `Save${editor.hasUnsavedTimeline ? ' *' : ''}`}
          </button>
          {!floatingExportVisible && <ExportPanel editor={editor} />}
        </>}
      />}
      left={fullStageMode ? null : <TimelineEditorLeftDock
        activeTabId={leftDockTabId}
        editor={editor}
        leftDockVisible={layoutPreference.leftDockVisible}
        projectPanelFloating={layoutPreference.floatingPanels.project.floating}
        onActiveTabChange={setLeftDockTabId}
      />}

      leftSplitter={fullStageMode ? null : <EditorLeftDockSplitter leftDockVisible={layoutPreference.leftDockVisible} leftDockWidth={layoutPreference.leftDockWidth} onLeftDockWidthChange={setLeftDockWidth} />}

      auxiliary={<AssetMetadataProbeHost
        failuresByAssetId={editor.metadataProbeFailuresByAssetId}
        onMetadata={editor.updateAssetMetadata}
        onProbeFailure={editor.reportMetadataProbeFailure}
        project={editor.project}
        retryRevisionsByAssetId={editor.metadataProbeRetryRevisionsByAssetId}
      />}

      program={<main className="editor-program-region" id="editor-program-panel" aria-labelledby="timeline-editor-title">
        {/* Keep the monitor's accessible heading while OpenCut renders the visible project header. */}
        <div className="visually-hidden">
          <p className="section-kicker">Local studio</p>
          <h1 id="timeline-editor-title">OpenScene</h1>
          <span className="editor-program-region__subtitle">Timeline editor</span>
        </div>
        {!shortsMode && shortsReturnContext !== null && editor.project?.id === shortsReturnContext.resultProjectId && (
          <div className="shorts-return-banner" data-testid="shorts-return-banner" role="region" aria-label="Return to Shorts review">
            <span>
              격리 쇼츠 프로젝트({shortsReturnContext.candidateId}) 편집 중 · 9:16 수동 Transform(얼굴추적 미포함) · 트림 · 자막 수정 후 저장하고 복귀하세요.
            </span>
            <button
              type="button"
              className="button button--primary"
              data-testid="shorts-return-to-review-btn"
              disabled={editor.isBusy}
              onClick={() => { void returnToShortsReview(); }}
            >
              {editor.hasUnsavedTimeline ? '저장 후 쇼츠 검토로 돌아가기' : '쇼츠 검토로 돌아가기'}
            </button>
          </div>
        )}
        <div className="editor-view" hidden={!canvasMode} data-cua-safe-surface={canvasMode && editor.project !== null ? 'canvas' : undefined}>
          {editor.project !== null && <VideoConnectionCanvas key={editor.project.id} editor={editor}
            locked={(isAgentBusy && !isCuaActing) || editor.isBusy} onPreview={() => selectEditorView('timeline')} />}
        </div>
        <div className="editor-view" hidden={!shortsMode} data-cua-safe-surface={shortsMode && editor.project !== null ? 'shorts-review' : undefined}>
          {shortsMode && editor.project !== null && (
            <ShortsReviewWorkspace
              editor={editor}
              initialJobId={restoredShortsTarget?.jobId ?? null}
              initialCandidateId={restoredShortsTarget?.candidateId ?? null}
              returnReloadToken={restoredShortsTarget?.token ?? 0}
              onOpenSettings={onOpenSettings}
              onOpenMaterializedProject={openMaterializedShortInEditor}
            />
          )}
        </div>
        <div className="editor-view" hidden={fullStageMode}>
            {floatingProgramVisible ? <div className="empty-slate">Program Monitor is floating above the workspace.</div> : <ProgramMonitor editor={editor} />}
        </div>
      </main>}

      programSplitter={fullStageMode ? null : <EditorProgramSplitter programPercent={layoutPreference.programPercent} onProgramPercentChange={setProgramPercent} />}

      inspector={!fullStageMode && dockedInspectorVisible ? inspectorPanel : null}

      inspectorSplitter={fullStageMode ? null : <EditorInspectorSplitter
        inspectorPlacement={layoutPreference.inspectorPlacement}
        inspectorVisible={layoutPreference.inspectorVisible}
        inspectorWidth={layoutPreference.inspectorWidth}
        leftDockVisible={layoutPreference.leftDockVisible}
        leftDockWidth={layoutPreference.leftDockWidth}
        onInspectorWidthChange={setInspectorWidth}
      />}

      floatingPanels={fullStageMode ? null : <div className="editor-floating-layer" aria-label="Floating workspace panels">
        {floatingProjectVisible && renderFloatingPanel({ child: <ProjectRail editor={editor} />, floatingPanel: layoutPreference.floatingPanels.project, panelId: 'project' })}
        {floatingProgramVisible && renderFloatingPanel({ child: <ProgramMonitor editor={editor} />, floatingPanel: layoutPreference.floatingPanels.program, panelId: 'program' })}
        {floatingInspectorVisible && renderFloatingPanel({ child: inspectorPanel, floatingPanel: layoutPreference.floatingPanels.inspector, panelId: 'inspector' })}
        {floatingExportVisible && renderFloatingPanel({ child: <ExportPanel editor={editor} />, floatingPanel: layoutPreference.floatingPanels.export, panelId: 'export' })}
      </div>}

      timeline={fullStageMode ? null : <TimelineCanvas id="editor-timeline-panel" editor={editor} />}
    />
  );
}
