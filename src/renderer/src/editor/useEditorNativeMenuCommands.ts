import { useEffect, useMemo, useRef } from 'react';
import { useRegisterApplicationMenu } from '../ApplicationMenuContext';

import type { TimelineMenuCommandId } from '../../../shared/timelineMenuCommands';
import { clipTimelineEndMs } from '../../../shared/timelineClipGeometry';
import { getEditorNativeMenuState } from './editorNativeMenuState';
import type {
  EditorFloatingPanelId,
  EditorFloatingPresetId,
  EditorInspectorPlacement,
  EditorLayoutPreference
} from './editorLayoutPreferences';
import type { TimelineEditorController } from './useTimelineEditor';
import { formatEditorShortcutChordForDisplay, getEditorShortcutBindings, type EditorShortcutPreferences } from './editorShortcuts';

export { getEditorNativeMenuState } from './editorNativeMenuState';

type EditorNativeMenuCommandsInput = {
  readonly editor: TimelineEditorController;
  readonly isAgentBusy: boolean;
  readonly timelinePlaybackAvailable?: boolean;
  readonly canvasMode: boolean;
  readonly shortcutPreferences: EditorShortcutPreferences;
  readonly layoutPreference: EditorLayoutPreference;
  readonly onApplyFloatingPreset: (presetId: EditorFloatingPresetId) => void;
  readonly onResetLayout: () => void;
  readonly onSetFloatingPanelMode: (panelId: EditorFloatingPanelId, floating: boolean) => void;
  readonly onSetInspectorPlacement: (placement: EditorInspectorPlacement) => void;
  readonly onToggleInspector: () => void;
  readonly onToggleLeftDock: () => void;
};

export function useEditorNativeMenuCommands(input: EditorNativeMenuCommandsInput): void {
  const registerMenu = useRegisterApplicationMenu();
  const runRef = useRef<(commandId: TimelineMenuCommandId) => void>(() => undefined);
  const editor = input.editor;
  const layout = input.layoutPreference;
  const shortcuts = useMemo(() => {
    const mapping = { playPause: 'playPause', undo: 'undo', redo: 'redo', splitSelection: 'splitAtPlayhead', deleteSelection: 'deleteClips', duplicateSelection: 'duplicateClip', selectAll: 'selectAllClips', clearSelection: 'clearClipSelection', saveTimeline: 'saveTimeline', toggleInspector: 'toggleInspector', toggleLeftDock: 'toggleLeftDock', resetLayout: 'resetLayout' } as const;
    const labels: Partial<Record<TimelineMenuCommandId, string>> = {};
    for (const binding of getEditorShortcutBindings(input.shortcutPreferences)) {
      const id = mapping[binding.actionId as keyof typeof mapping];
      if (id && binding.chord) labels[id] = formatEditorShortcutChordForDisplay(binding.chord);
    }
    return labels;
  }, [input.shortcutPreferences]);
  const menuState = useMemo(() => getEditorNativeMenuState({
    canRedoTimeline: editor.canRedoTimeline,
    canSplitAtPlayhead: editor.selectedClip !== null && editor.playheadMs > editor.selectedClip.clip.timelineStartMs && editor.playheadMs < clipTimelineEndMs(editor.selectedClip.clip),
    hasSelectedClip: editor.selectedClip !== null,
    canDetachAudio: editor.selectedClip?.asset?.kind === 'video',
    canvasMode: input.canvasMode,
    canUndoTimeline: editor.canUndoTimeline,
    hasProject: editor.project !== null,
    hasUnsavedTimeline: editor.hasUnsavedTimeline,
    isBusy: editor.isBusy || input.isAgentBusy,
    isPlaying: editor.isPlaying,
    timelinePlaybackAvailable: input.timelinePlaybackAvailable !== false,
    layoutPreference: layout
  }), [
    editor.canRedoTimeline,
    editor.canUndoTimeline,
    editor.hasUnsavedTimeline,
    editor.isBusy,
    input.isAgentBusy,
    input.timelinePlaybackAvailable,
    editor.isPlaying,
    editor.project,
    editor.selectedClip,
    editor.playheadMs,
    input.canvasMode,
    layout
  ]);

  useEffect(() => {
    const handlers: Readonly<Record<TimelineMenuCommandId, () => void>> = {
      playPause: () => editor.setIsPlaying((current) => !current),
      rewind: () => editor.setPlayheadMs(0),
      undo: editor.undoTimeline,
      redo: editor.redoTimeline,
      splitAtPlayhead: editor.splitAtPlayhead,
      trimStartToPlayhead: () => { if (editor.selectedClip) editor.trimClipTo(editor.selectedClip.clip.id, 'left', editor.playheadMs); },
      trimEndToPlayhead: () => { if (editor.selectedClip) editor.trimClipTo(editor.selectedClip.clip.id, 'right', editor.playheadMs); },
      duplicateClip: editor.duplicateSelectedClip,
      deleteClips: editor.deleteSelectedClip,
      detachAudio: () => void editor.detachSelectedClipAudio(),
      selectAllClips: editor.selectAllClips,
      clearClipSelection: editor.clearSelection,
      addVideoTrack: () => editor.addTimelineTrack('video'),
      addAudioTrack: () => editor.addTimelineTrack('audio'),
      toggleLeftDock: input.onToggleLeftDock,
      toggleInspector: input.onToggleInspector,
      setInspectorLeft: () => input.onSetInspectorPlacement('left'),
      setInspectorRight: () => input.onSetInspectorPlacement('right'),
      setInspectorFloating: () => input.onSetInspectorPlacement('floating'),
      toggleProjectFloating: () => input.onSetFloatingPanelMode('project', !layout.floatingPanels.project.floating),
      toggleProgramFloating: () => input.onSetFloatingPanelMode('program', !layout.floatingPanels.program.floating),
      toggleInspectorFloating: () => input.onSetFloatingPanelMode('inspector', !layout.floatingPanels.inspector.floating),
      toggleExportFloating: () => input.onSetFloatingPanelMode('export', !layout.floatingPanels.export.floating),
      applyCompactReviewPreset: () => input.onApplyFloatingPreset('compactReview'),
      applyReviewDeckPreset: () => input.onApplyFloatingPreset('reviewDeck'),
      resetLayout: input.onResetLayout,
      saveTimeline: () => void editor.saveTimeline()
    };
    const run = (commandId: TimelineMenuCommandId): void => {
      if (menuState.commands[commandId].enabled) handlers[commandId]();
    };
    runRef.current = run;
    return window.videoTool.onTimelineMenuCommand(run);
  }, [editor, input, layout, menuState]);

  useEffect(() => {
    registerMenu?.({ state: menuState, shortcuts, run: command => runRef.current(command) });
    return () => registerMenu?.(null);
  }, [menuState, shortcuts, registerMenu]);

  useEffect(() => {
    const reportMenuState = (): void => window.videoTool.updateTimelineMenuState(menuState);
    reportMenuState();
    window.addEventListener('focus', reportMenuState);
    return () => window.removeEventListener('focus', reportMenuState);
  }, [menuState]);
}
