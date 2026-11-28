import type { TimelineMenuState } from '../../../shared/timelineMenuCommands';
import type { EditorLayoutPreference } from './editorLayoutPreferences';

export type EditorNativeMenuStateInput = {
  readonly canRedoTimeline: boolean;
  readonly canSplitAtPlayhead: boolean;
  readonly hasSelectedClip?: boolean;
  readonly canDetachAudio?: boolean;
  readonly canvasMode?: boolean;
  readonly canUndoTimeline: boolean;
  readonly hasProject: boolean;
  readonly hasUnsavedTimeline: boolean;
  readonly isBusy: boolean;
  readonly isPlaying: boolean;
  readonly timelinePlaybackAvailable?: boolean;
  readonly layoutPreference: EditorLayoutPreference;
};

function commandState(enabled: boolean, checked = false) {
  return { enabled, checked } as const;
}

export function getEditorNativeMenuState(input: EditorNativeMenuStateInput): TimelineMenuState {
  const layout = input.layoutPreference;
  const inspectorVisible = layout.inspectorVisible;
  const canEditClip = (input.hasSelectedClip ?? input.canSplitAtPlayhead) && !input.isBusy;
  const timelinePanels = !input.canvasMode;
  return {
    playPauseLabel: input.isPlaying ? 'Pause' : 'Play',
    commands: {
      playPause: commandState(input.hasProject && input.timelinePlaybackAvailable !== false),
      rewind: commandState(input.hasProject && input.timelinePlaybackAvailable !== false),
      undo: commandState(input.canUndoTimeline),
      redo: commandState(input.canRedoTimeline),
      splitAtPlayhead: commandState(input.canSplitAtPlayhead),
      trimStartToPlayhead: commandState(input.canSplitAtPlayhead && !input.isBusy),
      trimEndToPlayhead: commandState(input.canSplitAtPlayhead && !input.isBusy),
      duplicateClip: commandState(canEditClip),
      deleteClips: commandState(canEditClip),
      detachAudio: commandState(canEditClip && (input.canDetachAudio ?? false)),
      selectAllClips: commandState(input.hasProject && !input.isBusy),
      clearClipSelection: commandState(canEditClip),
      addVideoTrack: commandState(input.hasProject),
      addAudioTrack: commandState(input.hasProject),
      toggleLeftDock: commandState(timelinePanels, layout.leftDockVisible),
      toggleInspector: commandState(timelinePanels, inspectorVisible),
      setInspectorLeft: commandState(timelinePanels, inspectorVisible && layout.inspectorPlacement === 'left'),
      setInspectorRight: commandState(timelinePanels, inspectorVisible && layout.inspectorPlacement === 'right'),
      setInspectorFloating: commandState(timelinePanels, inspectorVisible && layout.inspectorPlacement === 'floating'),
      toggleProjectFloating: commandState(timelinePanels, layout.floatingPanels.project.floating),
      toggleProgramFloating: commandState(timelinePanels, layout.floatingPanels.program.floating),
      toggleInspectorFloating: commandState(timelinePanels, layout.floatingPanels.inspector.floating),
      toggleExportFloating: commandState(timelinePanels, layout.floatingPanels.export.floating),
      applyCompactReviewPreset: commandState(true),
      applyReviewDeckPreset: commandState(true),
      resetLayout: commandState(true),
      saveTimeline: commandState(input.hasProject && input.hasUnsavedTimeline && !input.isBusy)
    }
  };
}
