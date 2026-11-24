import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  CUA_SAFE_SHORTCUT_ACTION_IDS,
  getCuaFixedSafeShortcutBindings,
  isShortcutActionAllowedDuringCua,
  parseEditorShortcutPreferences,
  resolveTimelineShortcutAction,
  type EditorShortcutActionId,
  type EditorShortcutChord,
  type EditorShortcutPreferences
} from '../src/renderer/src/editor/editorShortcuts';

function makeKeyEvent(
  key: string,
  modifiers: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}
) {
  return {
    key,
    altKey: modifiers.altKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false
  };
}

function makeRemappedPreferences(
  overrides: Partial<Record<EditorShortcutActionId, EditorShortcutChord | null>>
): EditorShortcutPreferences {
  const defaults = parseEditorShortcutPreferences(null);
  return {
    ...defaults,
    overrides: {
      ...defaults.overrides,
      ...overrides
    }
  };
}

describe('CUA shortcut security boundary', () => {
  it('excludes saveTimeline, Escape clearSelection, and layout chrome toggles from the fixed CUA keymap', () => {
    const fixedIds = new Set(getCuaFixedSafeShortcutBindings().map((b) => b.actionId));
    expect(CUA_SAFE_SHORTCUT_ACTION_IDS.has('saveTimeline')).toBe(false);
    expect(isShortcutActionAllowedDuringCua('saveTimeline')).toBe(false);
    expect(fixedIds.has('saveTimeline')).toBe(false);
    expect(fixedIds.has('clearSelection')).toBe(false);
    expect(fixedIds.has('toggleLeftDock')).toBe(false);
    expect(fixedIds.has('toggleInspector')).toBe(false);
    expect(fixedIds.has('resetLayout')).toBe(false);

    expect(fixedIds.has('undo')).toBe(true);
    expect(fixedIds.has('redo')).toBe(true);
    expect(fixedIds.has('playPause')).toBe(true);
    expect(fixedIds.has('stepBackward')).toBe(true);
    expect(fixedIds.has('stepForward')).toBe(true);
    expect(fixedIds.has('deleteSelection')).toBe(true);
  });

  it('completely ignores user remaps during CUA preparing/acting so remapped saveTimeline or chrome commands can never fire', () => {
    // 1. User remaps saveTimeline -> ArrowUp, resetLayout -> ArrowDown, toggleInspector -> z,
    //    and remaps deleteSelection -> ArrowLeft (swapping semantics).
    const maliciousPrefs = makeRemappedPreferences({
      saveTimeline: { modifiers: [], key: 'ArrowUp' },
      resetLayout: { modifiers: [], key: 'ArrowDown' },
      toggleInspector: { modifiers: [], key: 'Z' },
      stepBackward: null,
      deleteSelection: { modifiers: [], key: 'ArrowLeft' }
    });

    // During CUA (isLocked=true, cuaActing=true) AND defense-in-depth (isLocked=false, cuaActing=true):
    for (const isLocked of [true, false]) {
      expect(resolveTimelineShortcutAction({ event: makeKeyEvent('ArrowUp'), shortcutPreferences: maliciousPrefs, isLocked, cuaActing: true })).toBeNull();
      expect(resolveTimelineShortcutAction({ event: makeKeyEvent('ArrowDown'), shortcutPreferences: maliciousPrefs, isLocked, cuaActing: true })).toBeNull();
      expect(resolveTimelineShortcutAction({ event: makeKeyEvent('z'), shortcutPreferences: maliciousPrefs, isLocked, cuaActing: true })).toBeNull();
      // Fixed semantic keymap: ArrowLeft stays stepBackward (NEVER user-remapped deleteSelection!).
      expect(resolveTimelineShortcutAction({ event: makeKeyEvent('ArrowLeft'), shortcutPreferences: maliciousPrefs, isLocked, cuaActing: true })).toBe('stepBackward');
    }

    // 2. User remaps saveTimeline directly onto Space or Meta+Z (fixed CUA safe keys):
    //    CUA keeps fixed safe semantics (playPause / undo) and NEVER triggers saveTimeline!
    const hijackPrefs = makeRemappedPreferences({
      playPause: null,
      undo: null,
      saveTimeline: { modifiers: ['Meta'], key: 'Z' }
    });
    expect(resolveTimelineShortcutAction({ event: makeKeyEvent('z', { metaKey: true }), shortcutPreferences: hijackPrefs, isLocked: true, cuaActing: true })).toBe('undo');
    expect(resolveTimelineShortcutAction({ event: makeKeyEvent('z', { ctrlKey: true }), shortcutPreferences: hijackPrefs, isLocked: true, cuaActing: true })).toBe('undo');
    expect(resolveTimelineShortcutAction({ event: makeKeyEvent('y', { ctrlKey: true }), shortcutPreferences: hijackPrefs, isLocked: true, cuaActing: true })).toBe('redo');
    expect(resolveTimelineShortcutAction({ event: makeKeyEvent(' '), shortcutPreferences: hijackPrefs, isLocked: true, cuaActing: true })).toBe('playPause');

    // 3. Normal non-CUA manual user state -> user's custom remaps work as configured!
    expect(resolveTimelineShortcutAction({ event: makeKeyEvent('ArrowUp'), shortcutPreferences: maliciousPrefs, isLocked: false, cuaActing: false })).toBe('saveTimeline');
    expect(resolveTimelineShortcutAction({ event: makeKeyEvent('ArrowDown'), shortcutPreferences: maliciousPrefs, isLocked: false, cuaActing: false })).toBe('resetLayout');
    expect(resolveTimelineShortcutAction({ event: makeKeyEvent('ArrowLeft'), shortcutPreferences: maliciousPrefs, isLocked: false, cuaActing: false })).toBe('deleteSelection');
    expect(resolveTimelineShortcutAction({ event: makeKeyEvent('z', { metaKey: true }), shortcutPreferences: hijackPrefs, isLocked: false, cuaActing: false })).toBe('saveTimeline');
  });

  it('uses getCuaFixedSafeShortcutBindings and explicit saveTimeline guard inside useTimelineShortcuts.ts', async () => {
    const source = await readFile(new URL('../src/renderer/src/editor/useTimelineShortcuts.ts', import.meta.url), 'utf8');
    expect(source).toContain('getCuaFixedSafeShortcutBindings()');
    expect(source).toContain('isShortcutActionAllowedDuringCua(matchedBinding.actionId)');
    expect(source).toContain('saveTimeline: (input) => {\n    if (input.cuaActing === true) return;');
  });
});
