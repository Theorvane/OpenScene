export const TIMELINE_MENU_COMMAND_IDS = [
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
] as const;

export type TimelineMenuCommandId = (typeof TIMELINE_MENU_COMMAND_IDS)[number];

export type TimelineMenuCommandState = {
  readonly checked: boolean;
  readonly enabled: boolean;
};

export type TimelineMenuState = {
  readonly commands: Readonly<Record<TimelineMenuCommandId, TimelineMenuCommandState>>;
  readonly playPauseLabel: 'Pause' | 'Play';
};

type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: PlainRecord, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isTimelineMenuCommandId(value: string): value is TimelineMenuCommandId {
  return TIMELINE_MENU_COMMAND_IDS.some((commandId) => commandId === value);
}

function isTimelineMenuCommandState(value: unknown): value is TimelineMenuCommandState {
  return isPlainRecord(value)
    && hasExactKeys(value, ['checked', 'enabled'])
    && typeof value.checked === 'boolean'
    && typeof value.enabled === 'boolean';
}

function isTimelineMenuState(value: unknown): value is TimelineMenuState {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['commands', 'playPauseLabel'])) return false;
  if (value.playPauseLabel !== 'Play' && value.playPauseLabel !== 'Pause') return false;
  const commands = value.commands;
  if (!isPlainRecord(commands) || !hasExactKeys(commands, TIMELINE_MENU_COMMAND_IDS)) return false;
  return TIMELINE_MENU_COMMAND_IDS.every((commandId) => isTimelineMenuCommandState(commands[commandId]));
}

export function parseTimelineMenuCommandId(value: unknown): TimelineMenuCommandId | null {
  return typeof value === 'string' && isTimelineMenuCommandId(value) ? value : null;
}

export function parseTimelineMenuState(value: unknown): TimelineMenuState | null {
  return isTimelineMenuState(value) ? value : null;
}

export function createDefaultTimelineMenuState(): TimelineMenuState {
  const disabled = { checked: false, enabled: false } as const;
  return {
    playPauseLabel: 'Play',
    commands: {
      playPause: disabled,
      rewind: disabled,
      undo: disabled,
      redo: disabled,
      splitAtPlayhead: disabled,
      trimStartToPlayhead: disabled,
      trimEndToPlayhead: disabled,
      duplicateClip: disabled,
      deleteClips: disabled,
      detachAudio: disabled,
      selectAllClips: disabled,
      clearClipSelection: disabled,
      addVideoTrack: disabled,
      addAudioTrack: disabled,
      toggleLeftDock: disabled,
      toggleInspector: disabled,
      setInspectorLeft: disabled,
      setInspectorRight: disabled,
      setInspectorFloating: disabled,
      toggleProjectFloating: disabled,
      toggleProgramFloating: disabled,
      toggleInspectorFloating: disabled,
      toggleExportFloating: disabled,
      applyCompactReviewPreset: disabled,
      applyReviewDeckPreset: disabled,
      resetLayout: disabled,
      saveTimeline: disabled
    }
  };
}
