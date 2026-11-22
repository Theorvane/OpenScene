import { BrowserWindow, ipcMain, Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import { parseWindowMenuAction } from '../shared/windowMenuActions';
import {
  TIMELINE_MENU_COMMAND_IDS,
  parseTimelineMenuState,
  type TimelineMenuCommandId,
  type TimelineMenuState
} from '../shared/timelineMenuCommands';

type TimelineMenuItemTarget = {
  checked: boolean;
  enabled: boolean;
  label: string;
};

type TimelineMenuTarget = {
  readonly getMenuItemById: (id: string) => TimelineMenuItemTarget | null;
};

type FocusedWindowTarget = {
  readonly webContents: {
    readonly send: (channel: string, commandId: TimelineMenuCommandId) => void;
  };
};

type GetFocusedWindow = () => FocusedWindowTarget | null;
type SendTimelineMenuCommand = (commandId: TimelineMenuCommandId) => void;

export function getTimelineMenuItemId(commandId: TimelineMenuCommandId): string {
  return `timeline:${commandId}`;
}

export function dispatchTimelineMenuCommand(
  commandId: TimelineMenuCommandId,
  getFocusedWindow: GetFocusedWindow = () => BrowserWindow.getFocusedWindow()
): void {
  getFocusedWindow()?.webContents.send(IPC_CHANNELS.timelineMenuCommand, commandId);
}

function createCommandItemFactory(onCommand: SendTimelineMenuCommand) {
  return (
    commandId: TimelineMenuCommandId,
    label: string,
    type: 'checkbox' | 'normal' | 'radio' = 'normal'
  ): MenuItemConstructorOptions => ({
    id: getTimelineMenuItemId(commandId),
    label,
    type,
    checked: false,
    enabled: false,
    click: () => onCommand(commandId)
  });
}

export function createApplicationMenuTemplate(
  onCommand: SendTimelineMenuCommand,
  /**
   * Reaching the updater on demand. The startup check is silent unless there is
   * an update; this is where a user who wants to know now can ask, and where an
   * up-to-date or failed answer is worth reporting.
   */
  onCheckForUpdates?: () => void
): MenuItemConstructorOptions[] {
  const commandItem = createCommandItemFactory(onCommand);
  const template: MenuItemConstructorOptions[] = [];
  // macOS always titles the first menu with the running bundle's name, so the
  // label is what a packaged OpenScene build shows; a dev run reads Electron.
  //
  // The updates item goes *inside* that menu. Pushing a second entry labelled
  // OpenScene — which is what this did — leaves the menu bar with two app-named
  // menus, the real one and a stub holding one item.
  if (process.platform === 'darwin') {
    template.push(
      onCheckForUpdates === undefined
        ? { label: 'OpenScene', role: 'appMenu' }
        : {
            label: 'OpenScene',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              // Where macOS users look for it: just under About.
              { label: 'Check for Updates…', click: onCheckForUpdates },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
    );
  }
  template.push(
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'Clip',
      submenu: [
        commandItem('splitAtPlayhead', 'Split at playhead'),
        commandItem('trimStartToPlayhead', 'Trim start to playhead'),
        commandItem('trimEndToPlayhead', 'Trim end to playhead'),
        { type: 'separator' },
        commandItem('duplicateClip', 'Duplicate clip'),
        commandItem('deleteClips', 'Delete selected clips'),
        { type: 'separator' },
        commandItem('detachAudio', 'Detach audio'),
        { type: 'separator' },
        commandItem('selectAllClips', 'Select all clips'),
        commandItem('clearClipSelection', 'Clear clip selection')
      ]
    },
    { role: 'viewMenu' },
    {
      label: 'Timeline',
      submenu: [
        commandItem('playPause', 'Play'),
        commandItem('rewind', 'Rewind'),
        { type: 'separator' },
        commandItem('undo', 'Undo'),
        commandItem('redo', 'Redo'),
        { type: 'separator' },
        {
          label: 'Add Track',
          submenu: [
            commandItem('addVideoTrack', 'Video Track'),
            commandItem('addAudioTrack', 'Audio Track')
          ]
        },
        { type: 'separator' },
        commandItem('saveTimeline', 'Save Timeline')
      ]
    },
    {
      label: 'Workspace',
      submenu: [
        {
          label: 'Panels',
          submenu: [
            commandItem('toggleLeftDock', 'Media library', 'checkbox'),
            commandItem('toggleInspector', 'Inspector', 'checkbox')
          ]
        },
        {
          label: 'Inspector Placement',
          submenu: [
            commandItem('setInspectorLeft', 'Left', 'radio'),
            commandItem('setInspectorRight', 'Right', 'radio'),
            commandItem('setInspectorFloating', 'Float', 'radio')
          ]
        },
        {
          label: 'Floating Panels',
          submenu: [
            commandItem('toggleProjectFloating', 'Project', 'checkbox'),
            commandItem('toggleProgramFloating', 'Program', 'checkbox'),
            commandItem('toggleInspectorFloating', 'Inspector', 'checkbox'),
            commandItem('toggleExportFloating', 'Export', 'checkbox')
          ]
        },
        {
          label: 'Presets',
          submenu: [
            commandItem('applyCompactReviewPreset', 'Compact review'),
            commandItem('applyReviewDeckPreset', 'Review deck')
          ]
        },
        { type: 'separator' },
        commandItem('resetLayout', 'Reset Layout')
      ]
    },
    { role: 'windowMenu' }
  );
  // Windows and Linux have no app menu, so Help is where an updates item goes.
  if (onCheckForUpdates !== undefined && process.platform !== 'darwin') {
    template.push({
      role: 'help',
      submenu: [{ label: 'Check for Updates…', click: onCheckForUpdates }]
    });
  }
  return template;
}

export function applyTimelineMenuState(menu: TimelineMenuTarget, state: TimelineMenuState): void {
  for (const commandId of TIMELINE_MENU_COMMAND_IDS) {
    const item = menu.getMenuItemById(getTimelineMenuItemId(commandId));
    if (item === null) continue;
    item.enabled = state.commands[commandId].enabled;
    item.checked = state.commands[commandId].checked;
  }
  const playPauseItem = menu.getMenuItemById(getTimelineMenuItemId('playPause'));
  if (playPauseItem !== null) playPauseItem.label = state.playPauseLabel;
}

export function installApplicationMenu(onCheckForUpdates?: () => void): void {
  const menu = Menu.buildFromTemplate(
    createApplicationMenuTemplate(dispatchTimelineMenuCommand, onCheckForUpdates)
  );
  Menu.setApplicationMenu(menu);
  ipcMain.on(IPC_CHANNELS.windowMenuAction, (event, payload: unknown) => {
    const window = BrowserWindow.getFocusedWindow();
    if (window === null || window.webContents !== event.sender) return;
    const action = parseWindowMenuAction(payload);
    if (action === null) return;
    const contents = window.webContents;
    switch (action) {
      case 'cut': contents.cut(); break;
      case 'copy': contents.copy(); break;
      case 'paste': contents.paste(); break;
      case 'selectAll': contents.selectAll(); break;
      case 'undoText': contents.undo(); break;
      case 'redoText': contents.redo(); break;
      case 'zoomIn': contents.setZoomLevel(Math.min(3, contents.getZoomLevel() + 0.5)); break;
      case 'zoomOut': contents.setZoomLevel(Math.max(-3, contents.getZoomLevel() - 0.5)); break;
      case 'resetZoom': contents.setZoomLevel(0); break;
      case 'fullscreen': window.setFullScreen(!window.isFullScreen()); break;
      case 'minimize': window.minimize(); break;
      case 'close': window.close(); break;
    }
  });
  ipcMain.on(IPC_CHANNELS.timelineMenuState, (event, payload: unknown) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow === null || focusedWindow.webContents !== event.sender) return;
    const state = parseTimelineMenuState(payload);
    if (state === null) return;
    applyTimelineMenuState(menu, state);
  });
}
