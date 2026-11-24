import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { TimelineMenuCommandId } from '../../shared/timelineMenuCommands';
import type { WindowMenuAction } from '../../shared/windowMenuActions';
import { useApplicationMenuController } from './ApplicationMenuContext';

type Item = { readonly label: string; readonly run: () => void; readonly disabled?: boolean; readonly checked?: boolean; readonly shortcut?: string } | null;
type Props = {
  readonly editorActive: boolean;
  readonly onProjects: () => void;
  readonly onSettings: () => void;
  readonly onToggleAssistant: () => void;
  readonly assistantVisible: boolean;
  readonly canToggleAssistant: boolean;
};

/** Native accelerators stay installed; these menus share the editor's command controller. */
export function ApplicationMenuBar(props: Props): ReactElement {
  const controller = useApplicationMenuController();
  const [open, setOpen] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const textTarget = (): boolean => previousFocus.current?.matches('input:not([type="range"]):not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"], [role="textbox"]') ?? false;
  const native = (action: WindowMenuAction): void => {
    previousFocus.current?.focus();
    window.videoTool.performWindowMenuAction(action);
  };
  const command = (id: TimelineMenuCommandId, label: string, shortcut?: string): Item => ({
    label,
    run: () => controller?.run(id),
    disabled: !props.editorActive || !controller?.state.commands[id].enabled,
    ...(/^(toggle|setInspector)/.test(id) ? { checked: controller?.state.commands[id].checked ?? false } : {}),
    ...(controller?.shortcuts[id] ? { shortcut: controller.shortcuts[id] } : controller === null && shortcut ? { shortcut } : {})
  });
  const edit = (id: 'undo' | 'redo', shortcut: string): Item => textTarget()
    ? { label: id === 'undo' ? 'Undo' : 'Redo', run: () => native(id === 'undo' ? 'undoText' : 'redoText'), shortcut }
    : command(id, id === 'undo' ? 'Undo' : 'Redo', shortcut);
  const menus: readonly { readonly label: string; readonly items: readonly Item[] }[] = [
    { label: 'File', items: [
      { label: 'Projects', run: props.onProjects }, command('saveTimeline', 'Save timeline', 'Ctrl+S'), null,
      { label: 'Settings', run: props.onSettings }, null,
      { label: 'Close window', run: () => native('close'), shortcut: 'Alt+F4' }
    ] },
    { label: 'Edit', items: [edit('undo', 'Ctrl+Z'), edit('redo', 'Ctrl+Shift+Z'), null,
      { label: 'Cut', run: () => native('cut'), shortcut: 'Ctrl+X', disabled: !textTarget() },
      { label: 'Copy', run: () => native('copy'), shortcut: 'Ctrl+C' },
      { label: 'Paste', run: () => native('paste'), shortcut: 'Ctrl+V', disabled: !textTarget() },
      textTarget() ? { label: 'Select all', run: () => native('selectAll'), shortcut: 'Ctrl+A' } : command('selectAllClips', 'Select all clips'),
      command('clearClipSelection', 'Clear clip selection')
    ] },
    { label: 'Clip', items: [
      command('splitAtPlayhead', 'Split at playhead', 'S'),
      command('trimStartToPlayhead', 'Trim start to playhead'), command('trimEndToPlayhead', 'Trim end to playhead'), null,
      command('duplicateClip', 'Duplicate clip'), command('deleteClips', 'Delete selected clips', 'Delete'), null,
      command('detachAudio', 'Detach audio')
    ] },
    { label: 'View', items: [
      command('toggleLeftDock', 'Media library'), command('toggleInspector', 'Inspector'),
      { label: 'Assistant', run: props.onToggleAssistant, checked: props.assistantVisible, disabled: !props.canToggleAssistant }, null,
      { label: 'Zoom in', run: () => native('zoomIn'), shortcut: 'Ctrl++' },
      { label: 'Zoom out', run: () => native('zoomOut'), shortcut: 'Ctrl+−' },
      { label: 'Actual size', run: () => native('resetZoom'), shortcut: 'Ctrl+0' }, null,
      { label: 'Full screen', run: () => native('fullscreen'), shortcut: 'F11' }
    ] },
    { label: 'Timeline', items: [
      command('playPause', controller?.state.playPauseLabel ?? 'Play', 'Space'), command('rewind', 'Rewind'), null,
      command('addVideoTrack', 'Add video track'), command('addAudioTrack', 'Add audio track'), null,
      command('saveTimeline', 'Save timeline', 'Ctrl+S')
    ] },
    { label: 'Workspace', items: [
      command('setInspectorLeft', 'Inspector on left'), command('setInspectorRight', 'Inspector on right'), command('setInspectorFloating', 'Float inspector'), null,
      command('toggleProjectFloating', 'Float project'), command('toggleProgramFloating', 'Float program'), command('toggleExportFloating', 'Float export'), null,
      command('applyCompactReviewPreset', 'Compact review'), command('applyReviewDeckPreset', 'Review deck'), command('resetLayout', 'Reset layout')
    ] },
    { label: 'Help', items: [{ label: 'Updates and version', run: props.onSettings }] }
  ];

  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    const close = (): void => setOpen(null);
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('blur', close);
    return () => { document.removeEventListener('pointerdown', closeOutside); window.removeEventListener('blur', close); };
  }, []);

  useEffect(() => {
    if (document.documentElement.dataset.platform !== 'win32') return;
    const access = (event: globalThis.KeyboardEvent): void => {
      // F10 is the Windows menu access key; Alt+letter also opens a menu directly.
      const index = event.key === 'F10' && !event.shiftKey ? 0
        : event.altKey && !event.ctrlKey && !event.metaKey ? ['f', 'e', 'c', 'v', 't', 'w', 'h'].indexOf(event.key.toLowerCase()) : -1;
      if (index < 0) return;
      event.preventDefault();
      if (!root.current?.contains(document.activeElement)) previousFocus.current = document.activeElement as HTMLElement;
      setOpen(index);
      root.current?.querySelectorAll<HTMLButtonElement>('[role="menubar"] > button')[index]?.focus();
    };
    window.addEventListener('keydown', access);
    return () => window.removeEventListener('keydown', access);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (open === null) return;
    const buttons = root.current?.querySelectorAll<HTMLButtonElement>('[role="menubar"] > button');
    if (event.key === 'Escape') {
      event.preventDefault(); setOpen(null); buttons?.[open]?.focus(); return;
    }
    if (event.key === 'Tab') { setOpen(null); return; }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = (open + (event.key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length;
      setOpen(next); buttons?.[next]?.focus(); return;
    }
    const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menu"] button:not(:disabled)') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault(); items[next]?.focus();
  };

  return <div className="application-menu" ref={root} onKeyDown={onKeyDown}>
    <span className="application-menu__brand" aria-hidden="true">O<span>·</span></span>
    <div role="menubar" aria-label="Application menu">
      {menus.map((menu, index) => <button key={menu.label} type="button" role="menuitem"
        id={`application-menu-${index}`} aria-haspopup="menu" aria-expanded={open === index}
        tabIndex={open === null ? index === 0 ? 0 : -1 : open === index ? 0 : -1}
        onPointerDown={() => { if (!root.current?.contains(document.activeElement)) previousFocus.current = document.activeElement as HTMLElement; }}
        onPointerEnter={() => { if (open !== null) setOpen(index); }}
        onClick={() => setOpen(open === index ? null : index)}>{menu.label}</button>)}
    </div>
    {open !== null && <div className="application-menu__popup" role="menu" data-cua-protected="chrome-menu" data-cua-protected-id="application-menu-popup" aria-labelledby={`application-menu-${open}`} style={{ left: root.current?.querySelectorAll<HTMLButtonElement>('[role="menubar"] > button')[open]?.offsetLeft ?? 0 }}>
      {menus[open]?.items.map((item, index) => item === null ? <div role="separator" key={index} /> : <button
        key={item.label} type="button" aria-label={item.label} role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        {...(item.checked === undefined ? {} : { 'aria-checked': item.checked })} disabled={item.disabled} tabIndex={-1}
        onClick={() => { setOpen(null); previousFocus.current?.focus(); item.run(); }}>
        <span className="application-menu__check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
        <span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}
      </button>)}
    </div>}
  </div>;
}
