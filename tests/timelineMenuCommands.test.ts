import { describe, expect, it } from 'vitest';

import {
  TIMELINE_MENU_COMMAND_IDS,
  createDefaultTimelineMenuState,
  parseTimelineMenuCommandId,
  parseTimelineMenuState
} from '../src/shared/timelineMenuCommands';

describe('timeline menu command contract', () => {
  it('Given the native Timeline bridge, When command IDs are enumerated, Then every command bar action has one stable unique ID', () => {
    expect(TIMELINE_MENU_COMMAND_IDS).toEqual([
      'playPause',
      'rewind',
      'undo',
      'redo',
      'splitAtPlayhead',
      'trimStartToPlayhead',
      'trimEndToPlayhead',
      'duplicateClip',
      'deleteClips',
      'detachAudio',
      'selectAllClips',
      'clearClipSelection',
      'addVideoTrack',
      'addAudioTrack',
      'toggleLeftDock',
      'toggleInspector',
      'setInspectorLeft',
      'setInspectorRight',
      'setInspectorFloating',
      'toggleProjectFloating',
      'toggleProgramFloating',
      'toggleInspectorFloating',
      'toggleExportFloating',
      'applyCompactReviewPreset',
      'applyReviewDeckPreset',
      'resetLayout',
      'saveTimeline'
    ]);
    expect(new Set(TIMELINE_MENU_COMMAND_IDS).size).toBe(TIMELINE_MENU_COMMAND_IDS.length);
  });

  it('Given values crossing the menu IPC boundary, When parsed, Then only approved command IDs are accepted', () => {
    expect(parseTimelineMenuCommandId('splitAtPlayhead')).toBe('splitAtPlayhead');
    expect(parseTimelineMenuCommandId('deleteSelection')).toBeNull();
    expect(parseTimelineMenuCommandId({ commandId: 'rewind' })).toBeNull();
  });

  it('Given the initial native menu, When no renderer state has arrived, Then commands are safely disabled and unchecked', () => {
    const state = createDefaultTimelineMenuState();

    expect(state.playPauseLabel).toBe('Play');
    expect(Object.keys(state.commands)).toEqual(TIMELINE_MENU_COMMAND_IDS);
    expect(Object.values(state.commands).every((command) => !command.enabled && !command.checked)).toBe(true);
  });

  it('Given a renderer state payload, When parsed, Then exact typed command state is accepted and malformed state is rejected', () => {
    const state = createDefaultTimelineMenuState();
    const enabledState = {
      ...state,
      playPauseLabel: 'Pause',
      commands: {
        ...state.commands,
        playPause: { enabled: true, checked: false },
        toggleInspector: { enabled: true, checked: true }
      }
    } as const;

    expect(parseTimelineMenuState(enabledState)).toEqual(enabledState);
    expect(parseTimelineMenuState({ ...enabledState, playPauseLabel: 'Stop' })).toBeNull();
    expect(parseTimelineMenuState({
      ...enabledState,
      commands: { ...enabledState.commands, unknownCommand: { enabled: true, checked: false } }
    })).toBeNull();
    expect(parseTimelineMenuState({
      ...enabledState,
      commands: { ...enabledState.commands, saveTimeline: { enabled: 'yes', checked: false } }
    })).toBeNull();
  });
});
