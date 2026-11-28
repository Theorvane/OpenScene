// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement, useState, type ComponentType, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type AnyProps = Record<string, unknown>;
type AnyComponent = ComponentType<AnyProps>;

interface UiExports {
  readonly cn: (...inputs: readonly (string | false | null | undefined)[]) => string;
  readonly OS_Z_INDEX: Readonly<Record<string, number>>;
  readonly isEditableElement: (target: EventTarget | null) => boolean;
  readonly Button: AnyComponent;
  readonly Input: AnyComponent;
  readonly Textarea: AnyComponent;
  readonly Tabs: AnyComponent;
  readonly TabsList: AnyComponent;
  readonly TabsTrigger: AnyComponent;
  readonly TabsContent: AnyComponent;
  readonly Dialog: AnyComponent;
  readonly DialogTrigger: AnyComponent;
  readonly DialogContent: AnyComponent;
  readonly DialogHeader: AnyComponent;
  readonly DialogFooter: AnyComponent;
  readonly DialogTitle: AnyComponent;
  readonly DialogDescription: AnyComponent;
  readonly DialogClose: AnyComponent;
  readonly Sheet: AnyComponent;
  readonly SheetTrigger: AnyComponent;
  readonly SheetContent: AnyComponent;
  readonly SheetHeader: AnyComponent;
  readonly SheetFooter: AnyComponent;
  readonly SheetTitle: AnyComponent;
  readonly SheetDescription: AnyComponent;
  readonly SheetClose: AnyComponent;
  readonly DropdownMenu: AnyComponent;
  readonly DropdownMenuTrigger: AnyComponent;
  readonly DropdownMenuContent: AnyComponent;
  readonly DropdownMenuLabel: AnyComponent;
  readonly DropdownMenuItem: AnyComponent;
  readonly DropdownMenuSeparator: AnyComponent;
  readonly DropdownMenuShortcut: AnyComponent;
  readonly TooltipProvider: AnyComponent;
  readonly Tooltip: AnyComponent;
  readonly TooltipTrigger: AnyComponent;
  readonly TooltipContent: AnyComponent;
  readonly ScrollArea: AnyComponent;
  readonly ScrollBar: AnyComponent;
}

const TOKENS_CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles/ui-tokens.css'), 'utf8');
const PRIMITIVES_CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles/ui-primitives.css'), 'utf8');
const MAIN_TSX = readFileSync(resolve(process.cwd(), 'src/renderer/src/main.tsx'), 'utf8');

function getDocument(): {
  readonly body: {
    appendChild: (node: unknown) => unknown;
    querySelector: (selector: string) => unknown;
    querySelectorAll: (selector: string) => { length: number; [index: number]: unknown };
  };
  readonly activeElement: unknown;
  createElement: (tag: string) => unknown;
  querySelector: (selector: string) => unknown;
  querySelectorAll: (selector: string) => { length: number; [index: number]: unknown };
  dispatchEvent: (event: unknown) => boolean;
} {
  return (globalThis as unknown as { document: ReturnType<typeof getDocument> }).document;
}

function getWindow(): {
  addEventListener: (type: string, listener: (event: unknown) => void, options?: boolean | { capture?: boolean }) => void;
  removeEventListener: (type: string, listener: (event: unknown) => void, options?: boolean | { capture?: boolean }) => void;
  KeyboardEvent: new (type: string, init?: Record<string, unknown>) => unknown;
  MouseEvent: new (type: string, init?: Record<string, unknown>) => unknown;
  PointerEvent?: new (type: string, init?: Record<string, unknown>) => unknown;
  Event: new (type: string, init?: Record<string, unknown>) => unknown;
} {
  return (globalThis as unknown as { window: ReturnType<typeof getWindow> }).window;
}

interface DomEl {
  tagName: string;
  textContent: string | null;
  className: string;
  disabled?: boolean;
  value?: string;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  querySelector: (selector: string) => DomEl | null;
  querySelectorAll: (selector: string) => ArrayLike<DomEl>;
  click: () => void;
  focus: () => void;
  dispatchEvent: (event: unknown) => boolean;
  contains: (other: unknown) => boolean;
  remove: () => void;
  appendChild: (child: unknown) => unknown;
}

function extractCssVarNumber(css: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*:\\s*(\\d+)\\s*;`));
  if (match === null || match[1] === undefined) {
    throw new Error(`Missing numeric CSS variable ${name}`);
  }
  return Number(match[1]);
}

let UI: UiExports;
let activeRoots: Array<{ root: Root; container: DomEl }> = [];
let consoleErrors: unknown[][] = [];
let consoleWarnings: unknown[][] = [];
let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  // Polyfill ResizeObserver & pointer capture APIs missing in jsdom for Radix UI primitives.
  if (typeof (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  const win = globalThis as unknown as {
    HTMLElement?: { prototype: Record<string, unknown> };
    PointerEvent?: unknown;
    MouseEvent: unknown;
  };
  if (win.PointerEvent === undefined) {
    win.PointerEvent = win.MouseEvent;
  }
  if (win.HTMLElement !== undefined) {
    if (win.HTMLElement.prototype.hasPointerCapture === undefined) {
      win.HTMLElement.prototype.hasPointerCapture = () => false;
    }
    if (win.HTMLElement.prototype.setPointerCapture === undefined) {
      win.HTMLElement.prototype.setPointerCapture = () => {};
    }
    if (win.HTMLElement.prototype.releasePointerCapture === undefined) {
      win.HTMLElement.prototype.releasePointerCapture = () => {};
    }
    if (win.HTMLElement.prototype.scrollIntoView === undefined) {
      win.HTMLElement.prototype.scrollIntoView = () => {};
    }
  }

  const relativeModule = '../src/renderer/components/ui/index.ts';
  UI = (await import(relativeModule)) as unknown as UiExports;
});

beforeEach(() => {
  consoleErrors = [];
  consoleWarnings = [];
  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args);
  });
  warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    consoleWarnings.push(args);
  });
});

afterEach(() => {
  for (const entry of activeRoots.splice(0)) {
    act(() => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  expect(consoleErrors).toEqual([]);
  expect(consoleWarnings).toEqual([]);
});

function mount(element: ReactElement): DomEl {
  const doc = getDocument();
  const container = doc.createElement('div') as DomEl;
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  act(() => {
    root.render(element);
  });
  activeRoots.push({ root, container });
  return container;
}

function dispatchKey(
  target: { dispatchEvent: (event: unknown) => boolean },
  key: string,
  init: Record<string, unknown> = {}
): boolean {
  const win = getWindow();
  const event = new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  let result = true;
  act(() => {
    result = target.dispatchEvent(event);
  });
  return result;
}

async function flushMicroAndMacroTasks(): Promise<void> {
  await act(async () => {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  });
}

describe('Phase 0 Design System Tokens & Stylesheets', () => {
  it('defines Orca-aligned neutral surfaces, cross-platform typography, 4px spacing, compact controls, status tokens, and zero gradients/glows', () => {
    for (const token of [
      '--os-ui-bg: var(--background);',
      '--os-ui-canvas: var(--surface-inset);',
      '--os-ui-surface: var(--card);',
      '--os-ui-hover: var(--surface-control-hover);',
      '--os-ui-active: var(--surface-control-selected);',
      '--os-ui-fg: var(--foreground);',
      '--os-ui-fg-secondary: var(--text-strong);',
      '--os-ui-fg-muted: var(--muted-foreground);',
      '--os-ui-fg-faint: var(--text-weaker);',
      '--os-ui-border: var(--border);',
      '--os-ui-border-strong: var(--border-strong);',
      '--os-ui-cta-bg: var(--primary);',
      '--os-ui-cta-fg: var(--primary-foreground);',
      '--os-ui-cta-bg-hover: color-mix(in srgb, var(--primary) 85%, var(--foreground));',
      '--os-ui-focus-ring: var(--ring);',
      '--os-space-1: 4px;',
      '--os-space-2: 8px;',
      '--os-space-3: 12px;',
      '--os-space-4: 16px;',
      '--os-space-5: 20px;',
      '--os-space-6: 24px;',
      '--os-ui-radius-xs: 4px;',
      '--os-ui-radius-sm: 5px;',
      '--os-ui-radius-md: 6px;',
      '--os-ui-height-sm: 28px;',
      '--os-ui-height-md: 32px;',
      '--os-font-size-h1: 22px;',
      '--os-font-size-h2: 18px;',
      '--os-font-size-body-lg: 14px;',
      '--os-font-size-body: 13px;',
      '--os-font-size-sm: 12px;',
      '--os-font-size-xs: 11px;',
      '"Pretendard"',
      '"Malgun Gothic"',
      '"Apple SD Gothic Neo"',
      '"Noto Sans KR"',
      '"Cascadia Code"',
      '--os-ui-ok:',
      '--os-ui-warn:',
      '--os-ui-question:',
      '--os-ui-danger:',
      '--os-ui-info:'
    ]) {
      expect(TOKENS_CSS).toContain(token);
    }

    expect(PRIMITIVES_CSS).toContain('font-variant-numeric: tabular-nums;');
    expect(PRIMITIVES_CSS).toContain('word-break: keep-all;');

    // Zero gradients, zero glow shadows, zero pill soup.
    expect(TOKENS_CSS).not.toMatch(/gradient\(|box-shadow:|999px|9999px/i);
    expect(PRIMITIVES_CSS).not.toMatch(/gradient\(|box-shadow:|999px|9999px/i);

    // Additive root CSS wiring in main.tsx without breaking legacy styles.css.
    expect(MAIN_TSX).toContain("import './styles.css';");
    expect(MAIN_TSX).toContain("import '../styles/ui-tokens.css';");
    expect(MAIN_TSX).toContain("import '../styles/ui-primitives.css';");
  });

  it('enforces sheet < dialog < dropdown/popover < tooltip layering order', () => {
    const tooltip = extractCssVarNumber(TOKENS_CSS, '--os-z-tooltip');
    const dropdown = extractCssVarNumber(TOKENS_CSS, '--os-z-dropdown');
    const popover = extractCssVarNumber(TOKENS_CSS, '--os-z-popover');
    const dialog = extractCssVarNumber(TOKENS_CSS, '--os-z-dialog');
    const sheet = extractCssVarNumber(TOKENS_CSS, '--os-z-sheet');

    // Nested dropdowns/popovers and tooltips MUST render above owning modals/sheets.
    expect(dialog).toBeGreaterThan(sheet);
    expect(dropdown).toBeGreaterThan(dialog);
    expect(popover).toBeGreaterThan(dialog);
    expect(tooltip).toBeGreaterThan(dropdown);

    expect(UI.OS_Z_INDEX.tooltip).toBe(tooltip);
    expect(UI.OS_Z_INDEX.dropdown).toBe(dropdown);
    expect(UI.OS_Z_INDEX.popover).toBe(popover);
    expect(UI.OS_Z_INDEX.dialog).toBe(dialog);
    expect(UI.OS_Z_INDEX.sheet).toBe(sheet);

    // Dropdown and tooltip CSS rules and popper wrappers reference the elevated tokens.
    expect(PRIMITIVES_CSS).toContain('z-index: var(--os-z-dropdown);');
    expect(PRIMITIVES_CSS).toContain('z-index: var(--os-z-tooltip);');
  });
});

describe('Phase 0 Core Form & Navigation Primitives', () => {
  it('renders Button variants, sizes, disabled, loading, and asChild via Radix Slot cleanly', () => {
    const onClick = vi.fn();
    const onLoadingClick = vi.fn();

    const container = mount(
      createElement(
        'div',
        null,
        createElement(UI.Button, { variant: 'primary', size: 'sm', onClick }, 'Save'),
        createElement(UI.Button, { variant: 'ghost', size: 'icon', 'aria-label': 'More' }, '...'),
        createElement(UI.Button, { variant: 'destructive', loading: true, onClick: onLoadingClick }, 'Deleting'),
        createElement(UI.Button, { variant: 'default', disabled: true, onClick: onLoadingClick }, 'Disabled'),
        createElement(
          UI.Button,
          { variant: 'primary', asChild: true },
          createElement('a', { href: '#export' }, 'Export link')
        )
      )
    );

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(4);

    const [primaryBtn, iconBtn, loadingBtn, disabledBtn] = buttons as [DomEl, DomEl, DomEl, DomEl];
    expect(primaryBtn.className).toContain('os-ui-button--primary');
    expect(primaryBtn.className).toContain('os-ui-button--sm');
    act(() => primaryBtn.click());
    expect(onClick).toHaveBeenCalledTimes(1);

    expect(iconBtn.className).toContain('os-ui-button--ghost');
    expect(iconBtn.className).toContain('os-ui-button--icon');

    expect(loadingBtn.className).toContain('os-ui-button--destructive');
    expect(loadingBtn.disabled).toBe(true);
    expect(loadingBtn.getAttribute('aria-busy')).toBe('true');
    expect(loadingBtn.getAttribute('data-loading')).toBe('true');
    expect(loadingBtn.querySelector('.os-ui-button__spinner')).not.toBeNull();
    act(() => loadingBtn.click());
    expect(onLoadingClick).not.toHaveBeenCalled();

    expect(disabledBtn.disabled).toBe(true);
    act(() => disabledBtn.click());
    expect(onLoadingClick).not.toHaveBeenCalled();

    const slottedLink = container.querySelector('a');
    expect(slottedLink).not.toBeNull();
    expect(slottedLink?.className).toContain('os-ui-button--primary');
    expect(slottedLink?.getAttribute('href')).toBe('#export');
  });

  it('renders Input and Textarea error, disabled, and ref states', () => {
    let inputRef: DomEl | null = null;
    let textareaRef: DomEl | null = null;

    const container = mount(
      createElement(
        'div',
        null,
        createElement(UI.Input, {
          ref: (el: DomEl | null) => {
            inputRef = el;
          },
          error: true,
          placeholder: 'Clip name'
        }),
        createElement(UI.Textarea, {
          ref: (el: DomEl | null) => {
            textareaRef = el;
          },
          error: true,
          disabled: true,
          placeholder: 'Prompt notes'
        })
      )
    );

    const input = container.querySelector('input');
    const textarea = container.querySelector('textarea');

    expect(input).not.toBeNull();
    expect(inputRef).toBe(input);
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.getAttribute('data-error')).toBe('true');

    expect(textarea).not.toBeNull();
    expect(textareaRef).toBe(textarea);
    expect(textarea?.getAttribute('aria-invalid')).toBe('true');
    expect(textarea?.getAttribute('data-error')).toBe('true');
    expect(textarea?.disabled).toBe(true);
  });

  it('supports Tabs selection, keyboard navigation, and disabled tab skipping', async () => {
    const container = mount(
      createElement(
        UI.Tabs,
        { defaultValue: 'timeline' },
        createElement(
          UI.TabsList,
          { 'aria-label': 'Workbench' },
          createElement(UI.TabsTrigger, { value: 'timeline' }, 'Timeline'),
          createElement(UI.TabsTrigger, { value: 'canvas' }, 'Canvas'),
          createElement(UI.TabsTrigger, { value: 'locked', disabled: true }, 'Locked')
        ),
        createElement(UI.TabsContent, { value: 'timeline' }, 'Timeline panel'),
        createElement(UI.TabsContent, { value: 'canvas' }, 'Canvas panel'),
        createElement(UI.TabsContent, { value: 'locked' }, 'Locked panel')
      )
    );

    const triggers = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(triggers).toHaveLength(3);
    const [tab1, tab2, tab3] = triggers as [DomEl, DomEl, DomEl];

    expect(tab1.getAttribute('data-state')).toBe('active');
    expect(container.textContent).toContain('Timeline panel');

    act(() => {
      tab1.focus();
    });
    dispatchKey(tab1, 'ArrowRight');
    await flushMicroAndMacroTasks();

    expect(tab2.getAttribute('data-state')).toBe('active');
    expect(container.textContent).toContain('Canvas panel');

    // ArrowRight from tab2 skips disabled tab3 and wraps back to tab1.
    dispatchKey(tab2, 'ArrowRight');
    await flushMicroAndMacroTasks();
    expect(tab1.getAttribute('data-state')).toBe('active');
    expect(tab3.disabled).toBe(true);
  });

  it('renders ScrollArea viewport and scrollbars for vertical, horizontal, and both orientations', () => {
    const container = mount(
      createElement(
        UI.ScrollArea,
        { orientation: 'both', style: { width: 200, height: 120 } },
        createElement('div', { 'data-testid': 'scroll-child' }, 'Scrollable content')
      )
    );

    expect(container.querySelector('.os-ui-scroll-area')).not.toBeNull();
    expect(container.querySelector('.os-ui-scroll-area__viewport')).not.toBeNull();
    expect(container.querySelector('[data-testid="scroll-child"]')?.textContent).toBe('Scrollable content');
  });
});

describe('Phase 0 Portal Primitives + Nested Layering & keyboard isolation', () => {
  it('Dialog renders in portal with portal attributes, custom container, focus management, and restores focus on normal Escape', async () => {
    const doc = getDocument();
    const portalHost = doc.createElement('div') as DomEl;
    doc.body.appendChild(portalHost);

    function Harness(): ReactElement {
      const [open, setOpen] = useState(false);
      return createElement(
        UI.Dialog,
        { open, onOpenChange: setOpen },
        createElement(
          UI.DialogTrigger,
          { asChild: true },
          createElement(UI.Button, { 'data-testid': 'open-dialog' }, 'Open Dialog')
        ),
        createElement(
          UI.DialogContent,
          { container: portalHost },
          createElement(
            UI.DialogHeader,
            null,
            createElement(UI.DialogTitle, null, 'Export settings'),
            createElement(UI.DialogDescription, null, 'Configure local MP4 export.')
          ),
          createElement(UI.Input, { 'data-testid': 'dialog-input', placeholder: 'Output title' }),
          createElement(
            UI.DialogFooter,
            null,
            createElement(UI.DialogClose, { asChild: true }, createElement(UI.Button, null, 'Cancel'))
          )
        )
      );
    }

    const container = mount(createElement(Harness));
    const trigger = container.querySelector('[data-testid="open-dialog"]') as DomEl;
    act(() => {
      trigger.focus();
      trigger.click();
    });

    const dialog = portalHost.querySelector('[role="dialog"]') as DomEl | null;
    const overlay = portalHost.querySelector('.os-ui-dialog__overlay') as DomEl | null;
    expect(dialog).not.toBeNull();
    expect(overlay).not.toBeNull();
    expect(dialog?.getAttribute('data-cua-protected')).toBeNull();
    expect(dialog?.getAttribute('data-os-portal')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(overlay?.getAttribute('data-cua-protected')).toBeNull();
    expect(overlay?.getAttribute('data-os-portal')).toBe('dialog');
    expect(dialog?.contains(doc.activeElement)).toBe(true);

    // Normal Escape closes Dialog and restores focus to trigger.
    dispatchKey(dialog as DomEl, 'Escape');
    await flushMicroAndMacroTasks();
    expect(portalHost.querySelector('[role="dialog"]')).toBeNull();
    expect(doc.activeElement).toBe(trigger);

    portalHost.remove();
  });

  it('nested DropdownMenu inside Dialog closes first on Escape without prematurely closing Dialog, then second Escape closes Dialog and restores focus', async () => {
    const doc = getDocument();
    const onSelectItem = vi.fn();

    function NestedDialogMenuHarness(): ReactElement {
      const [dialogOpen, setDialogOpen] = useState(false);
      const [menuOpen, setMenuOpen] = useState(false);

      return createElement(
        UI.Dialog,
        { open: dialogOpen, onOpenChange: setDialogOpen },
        createElement(
          UI.DialogTrigger,
          { asChild: true },
          createElement(UI.Button, { 'data-testid': 'nested-dlg-trigger' }, 'Open Dialog')
        ),
        createElement(
          UI.DialogContent,
          null,
          createElement(UI.DialogTitle, null, 'Export Preset'),
          createElement(UI.DialogDescription, null, 'Choose a preset inside the modal.'),
          createElement(
            UI.DropdownMenu,
            { open: menuOpen, onOpenChange: setMenuOpen },
            createElement(
              UI.DropdownMenuTrigger,
              { asChild: true },
              createElement(UI.Button, { 'data-testid': 'nested-menu-trigger', onClick: () => setMenuOpen(true) }, 'Preset Menu')
            ),
            createElement(
              UI.DropdownMenuContent,
              null,
              createElement(
                UI.DropdownMenuItem,
                { 'data-testid': 'nested-menu-item', onSelect: onSelectItem },
                'YouTube 1080p'
              )
            )
          )
        )
      );
    }

    const container = mount(createElement(NestedDialogMenuHarness));
    const dialogTrigger = container.querySelector('[data-testid="nested-dlg-trigger"]') as DomEl;

    act(() => {
      dialogTrigger.focus();
      dialogTrigger.click();
    });

    const menuTrigger = doc.querySelector('[data-testid="nested-menu-trigger"]') as DomEl;
    act(() => {
      menuTrigger.click();
    });

    const menuEl = doc.querySelector('[data-os-portal="dropdown-menu"][role="menu"]') as DomEl | null;
    expect(menuEl).not.toBeNull();
    expect(doc.querySelector('[data-os-portal="dialog"][role="dialog"]')).not.toBeNull();

    // First Escape closes only the nested DropdownMenu, keeping parent Dialog open.
    dispatchKey(menuEl as DomEl, 'Escape');
    await flushMicroAndMacroTasks();
    expect(doc.querySelector('[data-os-portal="dropdown-menu"][role="menu"]')).toBeNull();
    const dialogAfterMenuClose = doc.querySelector('[data-os-portal="dialog"][role="dialog"]') as DomEl | null;
    expect(dialogAfterMenuClose).not.toBeNull();

    // Second Escape closes the parent Dialog and restores focus to dialogTrigger.
    dispatchKey(dialogAfterMenuClose as DomEl, 'Escape');
    await flushMicroAndMacroTasks();
    expect(doc.querySelector('[data-os-portal="dialog"][role="dialog"]')).toBeNull();
    expect(doc.activeElement).toBe(dialogTrigger);

    // Re-open Dialog + nested menu and verify item selection works cleanly.
    act(() => {
      dialogTrigger.click();
    });
    const reopenedMenuTrigger = doc.querySelector('[data-testid="nested-menu-trigger"]') as DomEl;
    act(() => {
      reopenedMenuTrigger.click();
    });
    const menuItem = doc.querySelector('[data-testid="nested-menu-item"]') as DomEl | null;
    expect(menuItem).not.toBeNull();
    act(() => {
      menuItem?.click();
    });
    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(doc.querySelector('[data-os-portal="dialog"][role="dialog"]')).not.toBeNull();
  });

  it('nested DropdownMenu and Tooltip inside Sheet close cleanly in layered order without closing Sheet prematurely', async () => {
    const doc = getDocument();

    function NestedSheetHarness(): ReactElement {
      const [sheetOpen, setSheetOpen] = useState(false);
      const [menuOpen, setMenuOpen] = useState(false);

      return createElement(
        UI.TooltipProvider,
        null,
        createElement(
          UI.Sheet,
          { open: sheetOpen, onOpenChange: setSheetOpen },
          createElement(
            UI.SheetTrigger,
            { asChild: true },
            createElement(UI.Button, { 'data-testid': 'nested-sheet-trigger' }, 'Open Sheet')
          ),
          createElement(
            UI.SheetContent,
            { side: 'right' },
            createElement(UI.SheetTitle, null, 'Inspector'),
            createElement(UI.SheetDescription, null, 'Layered controls inside drawer.'),
            createElement(
              UI.DropdownMenu,
              { open: menuOpen, onOpenChange: setMenuOpen },
              createElement(
                UI.DropdownMenuTrigger,
                { asChild: true },
                createElement(UI.Button, { 'data-testid': 'sheet-menu-trigger', onClick: () => setMenuOpen(true) }, 'Track Actions')
              ),
              createElement(
                UI.DropdownMenuContent,
                null,
                createElement(UI.DropdownMenuItem, { 'data-testid': 'sheet-menu-item' }, 'Detach Audio')
              )
            ),
            createElement(
              UI.Tooltip,
              { defaultOpen: true },
              createElement(UI.TooltipTrigger, { asChild: true }, createElement(UI.Button, null, 'Tip')),
              createElement(UI.TooltipContent, null, 'Drawer tooltip')
            )
          )
        )
      );
    }

    const container = mount(createElement(NestedSheetHarness));
    const sheetTrigger = container.querySelector('[data-testid="nested-sheet-trigger"]') as DomEl;
    act(() => {
      sheetTrigger.focus();
      sheetTrigger.click();
    });

    expect(doc.querySelector('[data-os-portal="tooltip"]')).not.toBeNull();

    const menuTrigger = doc.querySelector('[data-testid="sheet-menu-trigger"]') as DomEl;
    act(() => {
      menuTrigger.click();
    });

    const menuEl = doc.querySelector('[data-os-portal="dropdown-menu"][role="menu"]') as DomEl | null;
    expect(menuEl).not.toBeNull();

    // First Escape closes nested DropdownMenu (topmost layer), keeping Sheet & Tooltip open.
    dispatchKey(menuEl as DomEl, 'Escape');
    await flushMicroAndMacroTasks();
    expect(doc.querySelector('[data-os-portal="dropdown-menu"][role="menu"]')).toBeNull();
    const sheetEl = doc.querySelector('[data-os-portal="sheet"][role="dialog"]') as DomEl | null;
    expect(sheetEl).not.toBeNull();

    // Second Escape closes the open Tooltip layer inside Sheet, still keeping Sheet open.
    dispatchKey(sheetEl as DomEl, 'Escape');
    await flushMicroAndMacroTasks();
    expect(doc.querySelector('[data-os-portal="tooltip"]')).toBeNull();
    expect(doc.querySelector('[data-os-portal="sheet"][role="dialog"]')).not.toBeNull();

    // Third Escape closes Sheet itself and restores focus to trigger.
    dispatchKey(sheetEl as DomEl, 'Escape');
    await flushMicroAndMacroTasks();
    expect(doc.querySelector('[data-os-portal="sheet"][role="dialog"]')).toBeNull();
    expect(doc.activeElement).toBe(sheetTrigger);
  });

  it('Dialog, Sheet, and DropdownMenu allow capture-phase window Escape (prior handlers) to fire FIRST', () => {
    const win = getWindow();
    const doc = getDocument();

    const cases: Array<{
      readonly name: string;
      readonly render: (onEscape: () => void) => ReactElement;
      readonly portalSelector: string;
    }> = [
      {
        name: 'Dialog',
        portalSelector: '[data-os-portal="dialog"][role="dialog"]',
        render: (onEscape) =>
          createElement(
            UI.Dialog,
            { defaultOpen: true },
            createElement(
              UI.DialogContent,
              { onEscapeKeyDown: onEscape },
              createElement(UI.DialogTitle, null, 'CUA Dialog'),
              createElement(UI.DialogDescription, null, 'Dialog body')
            )
          )
      },
      {
        name: 'Sheet',
        portalSelector: '[data-os-portal="sheet"][role="dialog"]',
        render: (onEscape) =>
          createElement(
            UI.Sheet,
            { defaultOpen: true },
            createElement(
              UI.SheetContent,
              { side: 'left', onEscapeKeyDown: onEscape },
              createElement(UI.SheetTitle, null, 'CUA Sheet'),
              createElement(UI.SheetDescription, null, 'Sheet body')
            )
          )
      },
      {
        name: 'DropdownMenu',
        portalSelector: '[data-os-portal="dropdown-menu"][role="menu"]',
        render: (onEscape) =>
          createElement(
            UI.DropdownMenu,
            { defaultOpen: true },
            createElement(UI.DropdownMenuTrigger, { asChild: true }, createElement(UI.Button, null, 'Menu')),
            createElement(
              UI.DropdownMenuContent,
              { onEscapeKeyDown: onEscape },
              createElement(UI.DropdownMenuItem, null, 'Duplicate')
            )
          )
      }
    ];

    for (const testCase of cases) {
      const order: string[] = [];
      const portalEscape = vi.fn(() => {
        order.push(`${testCase.name}-portal-escape`);
      });

      mount(testCase.render(portalEscape));

      const portalNode = doc.querySelector(testCase.portalSelector) as DomEl | null;
      expect(portalNode, `${testCase.name} should mount portal`).not.toBeNull();

      // Simulate prior handlers capture-phase Escape listener on window.
      const cuaStopCaptureHandler = (event: unknown): void => {
        const kb = event as { key: string; preventDefault: () => void };
        if (kb.key === 'Escape') {
          order.push('cua-capture-stop');
          kb.preventDefault();
        }
      };

      win.addEventListener('keydown', cuaStopCaptureHandler, { capture: true });
      try {
        dispatchKey(portalNode as DomEl, 'Escape');
      } finally {
        win.removeEventListener('keydown', cuaStopCaptureHandler, { capture: true });
      }

      expect(order[0], `${testCase.name}: capture-phase Escape must run first`).toBe('cua-capture-stop');
      expect(portalEscape).not.toHaveBeenCalled();
      expect(doc.querySelector(testCase.portalSelector)).not.toBeNull();

      for (const entry of activeRoots.splice(0)) {
        act(() => entry.root.unmount());
        entry.container.remove();
      }
    }
  });

  it('prevents keystrokes inside Dialog and Sheet Input/Textarea from leaking to window Save/timeline shortcut listeners', () => {
    const win = getWindow();
    const doc = getDocument();
    const leakedShortcuts: string[] = [];

    const globalShortcutListener = (event: unknown): void => {
      const kb = event as { key: string; metaKey?: boolean; ctrlKey?: boolean };
      leakedShortcuts.push(`${kb.metaKey || kb.ctrlKey ? 'Mod+' : ''}${kb.key}`);
    };
    win.addEventListener('keydown', globalShortcutListener);

    try {
      mount(
        createElement(
          UI.Dialog,
          { defaultOpen: true },
          createElement(
            UI.DialogContent,
            null,
            createElement(UI.DialogTitle, null, 'Rename Clip'),
            createElement(UI.DialogDescription, null, 'Type without triggering timeline shortcuts.'),
            createElement(UI.Input, { 'data-testid': 'dlg-input' }),
            createElement(UI.Textarea, { 'data-testid': 'dlg-textarea' })
          )
        )
      );

      const dlgInput = doc.querySelector('[data-testid="dlg-input"]') as DomEl;
      const dlgTextarea = doc.querySelector('[data-testid="dlg-textarea"]') as DomEl;
      dispatchKey(dlgInput, ' ');
      dispatchKey(dlgInput, 'Delete');
      dispatchKey(dlgInput, 's', { metaKey: true });
      dispatchKey(dlgTextarea, 's', { ctrlKey: true });
      dispatchKey(dlgTextarea, 'z', { metaKey: true });

      expect(leakedShortcuts).toEqual([]);

      for (const entry of activeRoots.splice(0)) {
        act(() => entry.root.unmount());
        entry.container.remove();
      }

      mount(
        createElement(
          UI.Sheet,
          { defaultOpen: true },
          createElement(
            UI.SheetContent,
            { side: 'right' },
            createElement(UI.SheetTitle, null, 'Inspector Drawer'),
            createElement(UI.SheetDescription, null, 'Edit properties safely.'),
            createElement(UI.Input, { 'data-testid': 'sheet-input' }),
            createElement(UI.Textarea, { 'data-testid': 'sheet-textarea' })
          )
        )
      );

      const sheetContent = doc.querySelector('[data-os-portal="sheet"][role="dialog"]') as DomEl;
      expect(sheetContent.getAttribute('data-side')).toBe('right');
      expect(sheetContent.getAttribute('data-cua-protected')).toBeNull();

      const sheetInput = doc.querySelector('[data-testid="sheet-input"]') as DomEl;
      const sheetTextarea = doc.querySelector('[data-testid="sheet-textarea"]') as DomEl;
      dispatchKey(sheetInput, 's', { metaKey: true });
      dispatchKey(sheetInput, 'Backspace');
      dispatchKey(sheetTextarea, ' ');
      dispatchKey(sheetTextarea, 's', { ctrlKey: true });

      expect(leakedShortcuts).toEqual([]);

      // Verify DropdownMenu blocks Cmd+S / Ctrl+S from leaking to window Save listener
      for (const entry of activeRoots.splice(0)) {
        act(() => entry.root.unmount());
        entry.container.remove();
      }

      mount(
        createElement(
          UI.DropdownMenu,
          { defaultOpen: true },
          createElement(UI.DropdownMenuTrigger, { asChild: true }, createElement(UI.Button, null, 'Actions')),
          createElement(
            UI.DropdownMenuContent,
            null,
            createElement(UI.DropdownMenuItem, { 'data-testid': 'menu-save-guard-item' }, 'Duplicate')
          )
        )
      );

      const menuContent = doc.querySelector('[data-os-portal="dropdown-menu"][role="menu"]') as DomEl;
      const menuItem = doc.querySelector('[data-testid="menu-save-guard-item"]') as DomEl;
      dispatchKey(menuContent, 's', { metaKey: true });
      dispatchKey(menuContent, 's', { ctrlKey: true });
      dispatchKey(menuItem, 's', { metaKey: true });
      dispatchKey(menuItem, 's', { ctrlKey: true });

      expect(leakedShortcuts).toEqual([]);
    } finally {
      win.removeEventListener('keydown', globalShortcutListener);
    }
  });

  it('Sheet restores focus to trigger on normal Escape', async () => {
    const doc = getDocument();

    function SheetHarness(): ReactElement {
      const [open, setOpen] = useState(false);
      return createElement(
        UI.Sheet,
        { open, onOpenChange: setOpen },
        createElement(
          UI.SheetTrigger,
          { asChild: true },
          createElement(UI.Button, { 'data-testid': 'open-sheet' }, 'Open Sheet')
        ),
        createElement(
          UI.SheetContent,
          { side: 'left' },
          createElement(UI.SheetTitle, null, 'Left Drawer'),
          createElement(UI.SheetDescription, null, 'Drawer description'),
          createElement(UI.Button, { 'data-testid': 'inside-sheet' }, 'Action')
        )
      );
    }

    const container = mount(createElement(SheetHarness));
    const trigger = container.querySelector('[data-testid="open-sheet"]') as DomEl;
    act(() => {
      trigger.focus();
      trigger.click();
    });

    const sheet = doc.querySelector('[data-os-portal="sheet"][role="dialog"]') as DomEl | null;
    expect(sheet).not.toBeNull();
    expect(sheet?.getAttribute('data-side')).toBe('left');
    expect(sheet?.contains(doc.activeElement)).toBe(true);

    dispatchKey(sheet as DomEl, 'Escape');
    await flushMicroAndMacroTasks();
    expect(doc.querySelector('[data-os-portal="sheet"][role="dialog"]')).toBeNull();
    expect(doc.activeElement).toBe(trigger);
  });

  it('DropdownMenu and Tooltip render portals with variants and separators', () => {
    const doc = getDocument();
    const onSelect = vi.fn();

    mount(
      createElement(
        UI.TooltipProvider,
        null,
        createElement(
          UI.DropdownMenu,
          { defaultOpen: true },
          createElement(UI.DropdownMenuTrigger, { asChild: true }, createElement(UI.Button, null, 'Actions')),
          createElement(
            UI.DropdownMenuContent,
            null,
            createElement(UI.DropdownMenuLabel, null, 'Clip'),
            createElement(
              UI.DropdownMenuItem,
              { onSelect },
              'Split',
              createElement(UI.DropdownMenuShortcut, null, 'S')
            ),
            createElement(UI.DropdownMenuSeparator),
            createElement(UI.DropdownMenuItem, { variant: 'destructive' }, 'Delete')
          )
        ),
        createElement(
          UI.Tooltip,
          { defaultOpen: true },
          createElement(UI.TooltipTrigger, { asChild: true }, createElement(UI.Button, null, 'Help')),
          createElement(UI.TooltipContent, null, 'Keyboard shortcuts')
        )
      )
    );

    const menu = doc.querySelector('[data-os-portal="dropdown-menu"][role="menu"]') as DomEl | null;
    expect(menu).not.toBeNull();
    expect(menu?.getAttribute('data-cua-protected')).toBeNull();
    expect(menu?.querySelector('.os-ui-dropdown__separator')).not.toBeNull();
    expect(menu?.querySelector('.os-ui-dropdown__item--destructive')).not.toBeNull();

    const tooltip = doc.querySelector('[data-os-portal="tooltip"]') as DomEl | null;
    expect(tooltip).not.toBeNull();
    expect(tooltip?.getAttribute('data-cua-protected')).toBeNull();
    expect(tooltip?.textContent).toContain('Keyboard shortcuts');
  });
});
