import type { ReactElement, ReactNode } from 'react';

type EditorHeaderProps = {
  readonly brand: string;
  readonly projectName: string;
  readonly themeMode: 'light' | 'dark';
  readonly themePreset: string;
  readonly themeOptions: readonly { readonly id: string; readonly label: string }[];
  readonly onThemeModeToggle: () => void;
  readonly onThemePresetChange: (presetId: string) => void;
  readonly actions?: ReactNode;
};

/** OpenScene workspace navigation around the existing OpenCut editing surface. */
export function EditorHeader({ brand, projectName, themeMode, themePreset, themeOptions, onThemeModeToggle, onThemePresetChange, actions }: EditorHeaderProps): ReactElement {
  return <>
    <strong className="oc-editor-header__brand">{brand}</strong>
    <span className="oc-editor-header__project" title={projectName}>{projectName}</span>
    <span className="oc-editor-header__spacer" />
    <details className="workbench-menu workbench-menu--appearance">
      <summary>Appearance</summary>
      <div className="workbench-menu__popover">
        <label htmlFor="workbench-theme">Color preset</label>
        <select id="workbench-theme" className="oc-editor-theme-picker" aria-label="Editor theme preset" value={themePreset} onChange={event => onThemePresetChange(event.currentTarget.value)}>
          {themeOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <button type="button" onClick={onThemeModeToggle} aria-label={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} theme`}>
          {themeMode === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
    </details>
    {actions}
  </>;
}
