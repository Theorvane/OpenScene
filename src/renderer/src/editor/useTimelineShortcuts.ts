import { useEffect, useRef } from 'react';

import {
  getEditorShortcutBindings,
  isEditorShortcutBindingMatch,
  type EditorShortcutActionId,
  type EditorShortcutPreferences
} from './editorShortcuts';
import { isTextEditingShortcutTarget } from './editorTimelineView';

/** One step is a coarse frame: fine enough to trim by, coarse enough to hold. */
const PLAYHEAD_STEP_MS = 100;
const CLIP_NUDGE_MS = 100;

type TimelineShortcutInput = {
  readonly canSplit: boolean;
  readonly isLocked: boolean;
  readonly timelinePlaybackAvailable?: boolean;
  readonly clearSelection: () => void;
  readonly deleteSelectedClip: () => void;
  readonly duplicateSelectedClip: () => void;
  readonly goToTimelineEnd: () => void;
  readonly goToTimelineStart: () => void;
  readonly moveSelectedClip: (deltaMs: number) => void;
  readonly saveTimeline: () => void;
  readonly stepPlayhead: (deltaMs: number) => void;
  readonly redoTimeline: () => void;
  readonly resetLayout: () => void;
  readonly selectAllClips: () => void;
  readonly setIsPlaying: (update: (current: boolean) => boolean) => void;
  readonly shortcutPreferences: EditorShortcutPreferences;
  readonly splitAtPlayhead: () => void;
  readonly toggleInspector: () => void;
  readonly toggleLeftDock: () => void;
  readonly undoTimeline: () => void;
};

const actionHandlers: Readonly<Record<EditorShortcutActionId, (input: TimelineShortcutInput) => void>> = {
  clearSelection: (input) => input.clearSelection(),
  deleteSelection: (input) => input.deleteSelectedClip(),
  duplicateSelection: (input) => input.duplicateSelectedClip(),
  goToEnd: (input) => input.goToTimelineEnd(),
  goToStart: (input) => input.goToTimelineStart(),
  nudgeSelectionLeft: (input) => input.moveSelectedClip(-CLIP_NUDGE_MS),
  nudgeSelectionRight: (input) => input.moveSelectedClip(CLIP_NUDGE_MS),
  saveTimeline: (input) => {
    input.saveTimeline();
  },
  stepBackward: (input) => input.stepPlayhead(-PLAYHEAD_STEP_MS),
  stepForward: (input) => input.stepPlayhead(PLAYHEAD_STEP_MS),
  playPause: (input) => input.setIsPlaying((current) => !current),
  redo: (input) => input.redoTimeline(),
  resetLayout: (input) => input.resetLayout(),
  selectAll: (input) => input.selectAllClips(),
  splitSelection: (input) => {
    if (input.canSplit) input.splitAtPlayhead();
  },
  toggleInspector: (input) => input.toggleInspector(),
  toggleLeftDock: (input) => input.toggleLeftDock(),
  undo: (input) => input.undoTimeline()
};

export function useTimelineShortcuts(latestInput: TimelineShortcutInput): void {
  const inputRef = useRef(latestInput);
  inputRef.current = latestInput;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const input = inputRef.current;
      const dispatchKey = (): void => {
        if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="menu"], [role="menubar"]'))) return;
        if (input.isLocked) return;
        const formTarget = isTextEditingShortcutTarget(event.target as { tagName?: string; isContentEditable?: boolean } | null);
        const sliderUndo = event.target instanceof HTMLInputElement && event.target.type === 'range'
          && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z';
        if (formTarget && !sliderUndo) return;
        const bindings = getEditorShortcutBindings(input.shortcutPreferences);
        const matchedBinding = bindings.find((binding) => isEditorShortcutBindingMatch(event, binding));
        if (matchedBinding === undefined) return;
        if (input.timelinePlaybackAvailable === false && ['playPause', 'stepBackward', 'stepForward', 'goToStart', 'goToEnd'].includes(matchedBinding.actionId)) return;
        if (matchedBinding.actionId !== 'splitSelection' || input.canSplit) {
          event.preventDefault();
          actionHandlers[matchedBinding.actionId](input);
        }
      };

      dispatchKey();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
