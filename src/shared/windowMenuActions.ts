export const WINDOW_MENU_ACTIONS = ['cut', 'copy', 'paste', 'selectAll', 'undoText', 'redoText', 'zoomIn', 'zoomOut', 'resetZoom', 'fullscreen', 'minimize', 'close'] as const;
export type WindowMenuAction = (typeof WINDOW_MENU_ACTIONS)[number];

export function parseWindowMenuAction(value: unknown): WindowMenuAction | null {
  return typeof value === 'string' && WINDOW_MENU_ACTIONS.some(action => action === value)
    ? value as WindowMenuAction : null;
}
