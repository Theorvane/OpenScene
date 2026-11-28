import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { ReaEditorAnalysisHost } from "./ReaEditorAnalysisHost";
import { EditorWorkspace } from '../../../../external/opencut/apps/web/src/components/editor/editor-workspace';

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
import { EditorPreview } from './EditorPreview';
import { VideoResultsList } from './VideoResultsList';
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
import { useCuaActing, useCuaOverlay } from '../cua/useCuaOverlay';
import { WorkspaceShell } from '../../components/workspace';
import '../../styles/workspace-shell.css';
import type { TabDefinition } from '../ui';
import { VideoConnectionCanvas } from './VideoConnectionCanvas';
import './videoCanvas.css';
import './editorWorkbench.css';

export type InspectorTabId = (typeof EDITOR_INSPECTOR_DOCK_TAB_IDS)[number];

export type EditorViewMode = 'timeline' | 'canvas' | 'shorts';

type TimelineEditorProps = {
  readonly editorView?: EditorViewMode;
  readonly onEditorViewChange?: (view: EditorViewMode) => void;
  readonly active?: boolean;
  readonly editor: TimelineEditorController;
  readonly onProjectSettings?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onProjects?: () => void;
  readonly onSelectProject?: (projectId: string) => void;
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

export function TimelineEditor({ editorView: controlledView, onEditorViewChange, active = true, editor, onProjectSettings, onOpenSettings, onProjects, onSelectProject }: TimelineEditorProps): ReactElement {
  const [localView, setLocalView] = useState<EditorViewMode>('shorts');
  const editorView = controlledView ?? localView;
  const [previewChoice, setPreviewChoice] = useState<{ projectId: string | null; source: boolean }>({ projectId: null, source: false });
  const inspectingSource = (editor.project?.assets.some(asset => asset.kind === 'video') ?? false) &&
    (!(editor.project?.timeline.tracks.some(track => track.clips.length > 0) ?? false) || (previewChoice.projectId === editor.project?.id && previewChoice.source));
  const setInspectingSource = useCallback((source: boolean) => setPreviewChoice({ projectId: editor.project?.id ?? null, source }), [editor.project?.id]);
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
  const chat = useAgentChat();
  const { isBusy: isAgentBusy, pendingApproval } = chat;
  const cua = useCuaOverlay();
  const isCuaActing = useCuaActing();
  const [leftDockTabId, setLeftDockTabId] = useState<EditorLeftDockTabId>('project');
  const [inspectorTabId, setInspectorTabId] = useState<InspectorTabId>('selection');
  const { layoutPreference, updateLayoutPreference } = useEditorLayoutPreference();
  const { shortcutPreferences } = useEditorShortcutPreference();
  const selectEditorView = (view: EditorViewMode): void => {
    setLocalView(view);
    onEditorViewChange?.(view);
    try {
      localStorage.setItem('openvideo-editor-view', view);
    } catch {
      // The selected view remains usable when browser storage is unavailable.
    }
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
    'oc-editor-host--unified',
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
  const workspaceProjects = editor.projects.map((project) => ({ id: project.id, name: project.name, updatedAtLabel: project.updatedAt }));

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
    isLocked: isAgentBusy || fullStageMode,
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
    <WorkspaceShell
      persistentContent
      mode={canvasMode ? 'node' : shortsMode ? 'natural' : 'precision'}
      onModeChange={(mode) => selectEditorView(mode === 'node' ? 'canvas' : mode === 'natural' ? 'shorts' : 'timeline')}
      projects={workspaceProjects}
      videoList={<VideoResultsList editor={editor} active={active} onSelectProject={onSelectProject} onInspectAsset={(id) => { editor.setSelectedAssetId(id); setInspectingSource(true); }} />}
      showCandidateNavigation={false}
      saveScopeLabel="현재 프로젝트 타임라인"
      activeProjectId={editor.project?.id ?? null}
      onSelectProject={(id) => onSelectProject?.(id)}
      onNewVideo={() => { void (async () => {
        if (editor.hasUnsavedTimeline && !await editor.saveTimeline()) return;
        await editor.createProject();
      })(); }}
      onOpenAssets={() => { selectEditorView('timeline'); setLeftDockTabId('media'); updateLayoutPreference((current) => ({ ...current, leftDockVisible: true })); }}
      onOpenSettings={() => onOpenSettings?.()}
      canUndo={editor.canUndoTimeline && !isAgentBusy && !editor.isBusy}
      onUndo={editor.undoTimeline}
      onRedo={editor.redoTimeline}
      canRedo={editor.canRedoTimeline && !isAgentBusy && !editor.isBusy}
      {...(editor.project === null || !editor.hasUnsavedTimeline || isAgentBusy || editor.isBusy || editor.isSavingTimeline ? {} : { onSave: () => { void editor.saveTimeline(); } })}
      onStop={() => { void cua?.triggerStop(); }}
      showAutomationStop={false}
      showProjectIdentity={false}
      showSettingsShortcut={false}
      onProjectSettings={onProjectSettings}
      actions={(fullStageMode || !floatingExportVisible) ? <ExportPanel editor={editor} /> : null}
      safety={{ sourcePreserved: editor.project !== null, dirty: editor.hasUnsavedTimeline, saving: editor.isSavingTimeline,
        pendingApprovalCount: pendingApproval === null ? 0 : 1,
        cuaStatus: cua?.state.phase === 'acting' || cua?.state.phase === 'ready' || cua?.state.phase === 'stopping' || cua?.state.phase === 'cleanup-failed' ? cua.state.phase : 'idle' }}
    >
    <EditorWorkspace
      mode="host"
      className={workspaceClassName}
      style={workspaceStyle}
      labelledBy="timeline-editor-title"
      left={<TimelineEditorLeftDock
        activeTabId={leftDockTabId}
        editor={editor}
        leftDockVisible={!fullStageMode && layoutPreference.leftDockVisible}
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
        <div className="editor-view" hidden={!canvasMode} data-cua-safe-surface={canvasMode && editor.project !== null ? 'canvas' : undefined}>
          {editor.project !== null && <VideoConnectionCanvas key={editor.project.id} editor={editor} showHistoryControls={false}
            locked={(isAgentBusy && !isCuaActing) || editor.isBusy} onPreview={() => selectEditorView('timeline')} />}
        </div>
        <div className={shortsMode ? 'editor-view editor-view--natural' : 'editor-view editor-view--precision'} hidden={canvasMode}>
          {active && !fullStageMode && <ReaEditorAnalysisHost editor={editor} locked={isAgentBusy || editor.isBusy} />}
          {floatingProgramVisible && !shortsMode
            ? <div className="empty-slate">Program Monitor is floating above the workspace.</div>
            : <EditorPreview editor={editor} active={active && !canvasMode} sourceMode={inspectingSource} onSourceModeChange={setInspectingSource} />}
          {shortsMode && !inspectingSource && <div className="natural-editing-context">
            <TimelineCanvas id="natural-timeline-panel" editor={editor} showHistoryControls={false} />
          </div>}
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
        {floatingProgramVisible && renderFloatingPanel({ child: <EditorPreview editor={editor} active={active && !canvasMode} sourceMode={inspectingSource} onSourceModeChange={setInspectingSource} />, floatingPanel: layoutPreference.floatingPanels.program, panelId: 'program' })}
        {floatingInspectorVisible && renderFloatingPanel({ child: inspectorPanel, floatingPanel: layoutPreference.floatingPanels.inspector, panelId: 'inspector' })}
        {floatingExportVisible && renderFloatingPanel({ child: <ExportPanel editor={editor} />, floatingPanel: layoutPreference.floatingPanels.export, panelId: 'export' })}
      </div>}

      timeline={!fullStageMode && !inspectingSource ? <div className="live-workspace-timeline"><TimelineCanvas id="editor-timeline-panel" editor={editor} showHistoryControls={false} /></div> : null}
    />
    </WorkspaceShell>
  );
}
