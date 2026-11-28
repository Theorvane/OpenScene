import { describe, expect, it } from 'vitest';

import { EDITOR_LAYOUT_DEFAULT_PREFERENCE } from '../src/renderer/src/editor/editorLayoutPreferences';
import { getEditorNativeMenuState } from '../src/renderer/src/editor/editorNativeMenuState';

describe('editor native menu state mapping', () => {
  it('disables hidden edited-clock commands while retaining save and history for source inspection', () => {
    const state = getEditorNativeMenuState({
      canRedoTimeline: true, canUndoTimeline: true, hasProject: true,
      hasUnsavedTimeline: true, isBusy: false, isPlaying: false, canSplitAtPlayhead: false,
      timelinePlaybackAvailable: false, layoutPreference: EDITOR_LAYOUT_DEFAULT_PREFERENCE
    });
    expect(state.commands.playPause.enabled).toBe(false);
    expect(state.commands.rewind.enabled).toBe(false);
    expect(state.commands.saveTimeline.enabled).toBe(true);
    expect(state.commands.undo.enabled).toBe(true);
    expect(state.commands.redo.enabled).toBe(true);
  });
  it('keeps trim disabled outside the clip and disables timeline panels in Canvas', () => {
    const state = getEditorNativeMenuState({
      canRedoTimeline: false, canUndoTimeline: true, hasProject: true, hasSelectedClip: true,
      hasUnsavedTimeline: true, isBusy: false, isPlaying: false, canSplitAtPlayhead: false,
      canDetachAudio: true, canvasMode: true, layoutPreference: EDITOR_LAYOUT_DEFAULT_PREFERENCE
    });
    expect(state.commands.trimStartToPlayhead.enabled).toBe(false);
    expect(state.commands.trimEndToPlayhead.enabled).toBe(false);
    expect(state.commands.duplicateClip.enabled).toBe(true);
    expect(state.commands.detachAudio.enabled).toBe(true);
    expect(state.commands.toggleInspector.enabled).toBe(false);
    expect(state.commands.toggleLeftDock.enabled).toBe(false);
    expect(state.commands.saveTimeline.enabled).toBe(true);
  });
  it('Given no open project, When menu state is derived, Then timeline mutations are disabled while layout commands remain enabled', () => {
    const state = getEditorNativeMenuState({
      canRedoTimeline: false,
      canUndoTimeline: false,
      hasProject: false,
      hasUnsavedTimeline: false,
      isBusy: false,
      isPlaying: false,
      canSplitAtPlayhead: false,
      layoutPreference: EDITOR_LAYOUT_DEFAULT_PREFERENCE
    });

    expect(state.playPauseLabel).toBe('Play');
    expect(state.commands.playPause.enabled).toBe(false);
    expect(state.commands.addVideoTrack.enabled).toBe(false);
    expect(state.commands.splitAtPlayhead.enabled).toBe(false);
    expect(state.commands.saveTimeline.enabled).toBe(false);
    expect(state.commands.toggleLeftDock).toEqual({ enabled: true, checked: true });
    expect(state.commands.setInspectorRight).toEqual({ enabled: true, checked: true });
    expect(state.commands.resetLayout.enabled).toBe(true);
  });

  it('Given active editor and layout state, When menu state is derived, Then it preserves button disabled, checked, and dynamic-label behavior', () => {
    const layoutPreference = {
      ...EDITOR_LAYOUT_DEFAULT_PREFERENCE,
      leftDockVisible: false,
      inspectorPlacement: 'floating',
      floatingPanels: {
        ...EDITOR_LAYOUT_DEFAULT_PREFERENCE.floatingPanels,
        project: { ...EDITOR_LAYOUT_DEFAULT_PREFERENCE.floatingPanels.project, floating: true },
        inspector: { ...EDITOR_LAYOUT_DEFAULT_PREFERENCE.floatingPanels.inspector, floating: true }
      }
    } as const;

    const state = getEditorNativeMenuState({
      canRedoTimeline: true,
      canUndoTimeline: true,
      hasProject: true,
      hasUnsavedTimeline: true,
      isBusy: false,
      isPlaying: true,
      canSplitAtPlayhead: true,
      layoutPreference
    });

    expect(state.playPauseLabel).toBe('Pause');
    expect(state.commands.undo.enabled).toBe(true);
    expect(state.commands.redo.enabled).toBe(true);
    expect(state.commands.splitAtPlayhead.enabled).toBe(true);
    expect(state.commands.saveTimeline.enabled).toBe(true);
    expect(state.commands.toggleLeftDock.checked).toBe(false);
    expect(state.commands.setInspectorFloating.checked).toBe(true);
    expect(state.commands.toggleProjectFloating.checked).toBe(true);
    expect(state.commands.toggleInspectorFloating.checked).toBe(true);
  });

  it('Given a save in progress, When menu state is derived, Then Save Timeline is disabled without disabling playback', () => {
    const state = getEditorNativeMenuState({
      canRedoTimeline: false,
      canUndoTimeline: false,
      hasProject: true,
      hasUnsavedTimeline: true,
      isBusy: true,
      isPlaying: false,
      canSplitAtPlayhead: false,
      layoutPreference: EDITOR_LAYOUT_DEFAULT_PREFERENCE
    });

    expect(state.commands.saveTimeline.enabled).toBe(false);
    expect(state.commands.playPause.enabled).toBe(true);
  });
});
