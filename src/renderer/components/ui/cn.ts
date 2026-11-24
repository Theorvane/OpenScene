import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export type ClassValue = string | false | null | undefined;

export function cn(...inputs: readonly ClassValue[]): string {
  const tokens: string[] = [];
  for (const input of inputs) {
    if (typeof input === 'string' && input.length > 0) {
      tokens.push(input);
    }
  }
  return tokens.join(' ');
}

/**
 * Valid `data-cua-protected` kinds recognized by the self-window CUA surface
 * collector (`CUA_VALID_PROTECTED_KINDS`).
 */
export type CuaProtectedKind =
  | 'stop-button'
  | 'approval-ui'
  | 'agent-panel'
  | 'settings'
  | 'chrome-menu'
  | 'modal';

export type OsPortalKind = 'dialog' | 'sheet' | 'dropdown-menu' | 'tooltip';

/**
 * Numeric mirror of `--os-z-*` CSS tokens in `src/renderer/styles/ui-tokens.css`.
 * Layering order:
 *   sheet (500) < dialog (600) < dropdown/popover (700) < tooltip (750) < cuaStop (9999)
 */
export const OS_Z_INDEX = {
  base: 0,
  sticky: 20,
  header: 100,
  sheet: 500,
  dialog: 600,
  popover: 700,
  dropdown: 700,
  tooltip: 750,
  cuaStop: 9999
} as const;

export function isEditableElement(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false;
  const candidate = target as { tagName?: unknown; isContentEditable?: unknown; getAttribute?: unknown };
  if (candidate.isContentEditable === true) return true;
  if (typeof candidate.getAttribute === 'function' && candidate.getAttribute('contenteditable') === 'true') {
    return true;
  }
  if (typeof candidate.tagName !== 'string') return false;
  const tag = candidate.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Prevents keystrokes typed inside modal `Dialog` / `Sheet` editable fields (or
 * modal shortcut combinations such as Cmd/Ctrl+S) from bubbling out to global
 * `window` Save or timeline shortcut listeners.
 *
 * Critical invariants:
 * - NEVER stops `Escape`, so capture-phase CUA emergency Stop listeners and
 *   Radix DismissableLayer escape handling always receive `Escape` normally.
 * - NEVER stops `Tab`, so Radix FocusScope focus trapping works undisturbed.
 */
export function isolateModalKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key === 'Escape' || event.key === 'Tab') {
    return;
  }
  if (isEditableElement(event.target)) {
    event.stopPropagation();
    return;
  }
  // Prevent background timeline/save shortcuts (e.g. Cmd/Ctrl+S, Space, Delete)
  // from firing behind an active modal dialog or sheet.
  if (event.metaKey || event.ctrlKey || event.altKey) {
    event.stopPropagation();
  }
}

/**
 * Ensures Radix portal `onEscapeKeyDown` cooperates cleanly with a
 * capture-phase `window` Escape listener (e.g. CUA emergency Stop):
 * if a capture-phase listener already called `event.preventDefault()`, the
 * portal respects that and avoids competing with emergency cancellation.
 */
export function composeCuaSafeEscapeHandler(
  userHandler?: (event: KeyboardEvent) => void
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return;
    }
    userHandler?.(event);
  };
}
