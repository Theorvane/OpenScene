import { useEffect, useState, type ReactElement } from 'react';
import { applyCaptionPreset, CAPTION_FONT_WEIGHTS, CAPTION_PLACEMENTS, CAPTION_STYLE_PRESETS, isAutomaticCaptionId, resolvedTitleStyle } from '../../../shared/captionStyle';
import { DEFAULT_TITLE, type TimelineTitleStyle } from '../../../shared/timelineTypes';
import { DEFAULT_TITLE_SHADOW, TITLE_FONT_FAMILIES, TITLE_FONT_LABELS, type TitleFontFamily } from '../../../shared/titleTypography';
import { Button } from '../ui';
import { PropertyGroup, PropertyRow, TimingInput } from './InspectorControls';
import type { TimelineEditorController } from './useTimelineEditor';

export function TypographyInspector({ editor }: { readonly editor: TimelineEditorController }): ReactElement {
  const [selectedId, setSelectedId] = useState('');
  const titles = editor.project?.timeline.titles ?? [];
  const title = titles.find(entry => entry.id === selectedId) ?? editor.titleAtPlayhead;
  const style = title ? resolvedTitleStyle(title) : null;
  const shadow = style?.shadow ?? DEFAULT_TITLE_SHADOW;
  const automaticCount = titles.filter(entry => isAutomaticCaptionId(entry.id)).length;
  useEffect(() => {
    const selected = titles.find(entry => entry.id === selectedId);
    if (selected && (editor.playheadMs < selected.timelineStartMs || editor.playheadMs >= selected.timelineEndMs)) setSelectedId('');
  }, [editor.playheadMs, selectedId, titles]);
  const changeStyle = (changes: Partial<TimelineTitleStyle>): void => {
    if (title && style) editor.editTitle(title.id, { style: { ...style, ...changes } });
  };

  return <section aria-label="Typography editor" className="typography-inspector">
    <fieldset className="inspector-fields" disabled={editor.isBusy}>
      <PropertyGroup title="Text">
        <div className="inspector-action-grid" role="toolbar" aria-label="Title controls">
          <Button className="inspector-action" onClick={() => setSelectedId(editor.addTitleAtPlayhead() ?? '')}>Add title</Button>
          <Button className="inspector-action" variant="stop" disabled={!title} onClick={() => { if (title) editor.deleteTitle(title.id); }}>Delete title</Button>
        </div>
        {titles.length > 0 && <select className="property-text-input" aria-label="Select title or caption" value={title?.id ?? ''} onChange={event => {
          const next = titles.find(entry => entry.id === event.currentTarget.value);
          if (next) { setSelectedId(next.id); editor.setPlayheadMs(next.timelineStartMs); }
        }}>
          <option value="" disabled>Select a title…</option>
          {titles.map(entry => <option key={entry.id} value={entry.id}>{entry.text.slice(0, 40) || 'Untitled'}</option>)}
        </select>}
        {title ? <input className="property-text-input typography-inspector__text" type="text" aria-label="Title text" value={title.text}
          onChange={event => editor.editTitle(title.id, { text: event.currentTarget.value })} />
          : <p className="inspector-help">Add a title at the playhead, or choose an existing title to edit its typography.</p>}
      </PropertyGroup>

      {title && style && <>
        <PropertyGroup title="Typography" onReset={() => editor.editTitle(title.id, { sizePx: DEFAULT_TITLE.sizePx, color: DEFAULT_TITLE.color, style: { ...style, fontWeight: 'regular', fontFamily: 'sans' } })}>
          <PropertyRow label="Font"><select className="property-text-input" aria-label="Title font family" value={style.fontFamily ?? 'sans'}
            onChange={event => changeStyle({ fontFamily: event.currentTarget.value as TitleFontFamily })}>
            {TITLE_FONT_FAMILIES.map(family => <option key={family} value={family}>{TITLE_FONT_LABELS[family]}</option>)}
          </select></PropertyRow>
          <PropertyRow label="Size (px)"><input className="property-number-input" type="number" aria-label="Title size" value={title.sizePx} min={8} max={512}
            onChange={event => editor.editTitle(title.id, { sizePx: Number(event.currentTarget.value) })} /></PropertyRow>
          <PropertyRow label="Weight"><select className="property-text-input" aria-label="Title font weight" value={style.fontWeight}
            onChange={event => changeStyle({ fontWeight: event.currentTarget.value as TimelineTitleStyle['fontWeight'] })}>
            {CAPTION_FONT_WEIGHTS.map(weight => <option key={weight} value={weight}>{weight === 'bold' ? 'Bold' : 'Regular'}</option>)}
          </select></PropertyRow>
          <PropertyRow label="Colour"><input className="property-color-input" type="color" aria-label="Title colour" value={title.color}
            onChange={event => editor.editTitle(title.id, { color: event.currentTarget.value })} /><span className="property-value-chip">{title.color.toUpperCase()}</span></PropertyRow>
        </PropertyGroup>

        <PropertyGroup title="Text styles">
          <div className="text-style-presets" role="group" aria-label="Text style presets">
            {CAPTION_STYLE_PRESETS.map(preset => <button key={preset.id} type="button" title={preset.description} aria-label={`Apply ${preset.label} text style`}
              onClick={() => {
                const next = applyCaptionPreset(title, preset.id);
                editor.editTitle(title.id, { sizePx: next.sizePx, color: next.color, positionX: next.positionX, positionY: next.positionY, style: next.style });
              }}><span aria-hidden="true" style={{ color: preset.color, fontWeight: preset.style.fontWeight === 'bold' ? 700 : 400,
                WebkitTextStroke: `${Math.min(1.5, preset.style.outlineWidthPx / 4)}px ${preset.style.outlineColor}`, paintOrder: 'stroke fill',
                backgroundColor: preset.style.backgroundOpacity > 0 ? preset.style.backgroundColor : 'transparent' }}>Aa</span><small>{preset.label}</small></button>)}
          </div>
        </PropertyGroup>

        <PropertyGroup title="Outline" onReset={() => changeStyle({ outlineWidthPx: 0, outlineColor: '#000000' })}>
          <label className="inspector-toggle"><input type="checkbox" aria-label="Enable title outline" checked={style.outlineWidthPx > 0}
            onChange={event => changeStyle({ outlineWidthPx: event.currentTarget.checked ? 3 : 0 })} />Outline</label>
          <PropertyRow label="Colour"><input className="property-color-input" type="color" aria-label="Title outline colour" value={style.outlineColor}
            onChange={event => changeStyle({ outlineColor: event.currentTarget.value })} /></PropertyRow>
          <PropertyRow label="Width (px)"><input className="property-number-input" type="number" aria-label="Title outline width" min={0} max={24} value={style.outlineWidthPx}
            onChange={event => changeStyle({ outlineWidthPx: Number(event.currentTarget.value) })} /></PropertyRow>
        </PropertyGroup>

        <PropertyGroup title="Shadow" onReset={() => changeStyle({ shadow: { ...DEFAULT_TITLE_SHADOW } })}>
          <label className="inspector-toggle"><input type="checkbox" aria-label="Enable title shadow" checked={shadow.opacity > 0}
            onChange={event => changeStyle({ shadow: { ...shadow, opacity: event.currentTarget.checked ? 0.7 : 0 } })} />Text shadow</label>
          <PropertyRow label="Colour"><input className="property-color-input" type="color" aria-label="Title shadow colour" value={shadow.color}
            onChange={event => changeStyle({ shadow: { ...shadow, color: event.currentTarget.value } })} /></PropertyRow>
          <PropertyRow label="Opacity"><input className="property-slider" type="range" aria-label="Title shadow opacity" min={0} max={1} step={0.01} value={shadow.opacity}
            onChange={event => changeStyle({ shadow: { ...shadow, opacity: Number(event.currentTarget.value) } })} /><span className="property-value-chip">{Math.round(shadow.opacity * 100)}%</span></PropertyRow>
          <PropertyRow label="Offset X"><input className="property-number-input" type="number" aria-label="Title shadow offset X" min={-100} max={100} value={shadow.offsetX}
            onChange={event => changeStyle({ shadow: { ...shadow, offsetX: Number(event.currentTarget.value) } })} /></PropertyRow>
          <PropertyRow label="Offset Y"><input className="property-number-input" type="number" aria-label="Title shadow offset Y" min={-100} max={100} value={shadow.offsetY}
            onChange={event => changeStyle({ shadow: { ...shadow, offsetY: Number(event.currentTarget.value) } })} /></PropertyRow>
        </PropertyGroup>
        <PropertyGroup title="Background" onReset={() => changeStyle({ backgroundColor: '#000000', backgroundOpacity: 0, paddingPx: 0 })}>
          <label className="inspector-toggle"><input type="checkbox" aria-label="Enable title background" checked={style.backgroundOpacity > 0}
            onChange={event => changeStyle({ backgroundOpacity: event.currentTarget.checked ? 0.72 : 0 })} />Background plate</label>
          <PropertyRow label="Colour"><input className="property-color-input" type="color" aria-label="Title background colour" value={style.backgroundColor}
            onChange={event => changeStyle({ backgroundColor: event.currentTarget.value })} /></PropertyRow>
          <PropertyRow label="Opacity"><input className="property-slider" type="range" aria-label="Title background opacity" min={0} max={1} step={0.01} value={style.backgroundOpacity}
            onChange={event => changeStyle({ backgroundOpacity: Number(event.currentTarget.value) })} /><span className="property-value-chip">{Math.round(style.backgroundOpacity * 100)}%</span></PropertyRow>
          <PropertyRow label="Padding (px)"><input className="property-number-input" type="number" aria-label="Title background padding" min={0} max={64} value={style.paddingPx}
            onChange={event => changeStyle({ paddingPx: Number(event.currentTarget.value) })} /></PropertyRow>
        </PropertyGroup>

        <PropertyGroup title="Layout & timing" defaultExpanded={false}>
          <PropertyRow label="Anchor"><select className="property-text-input" aria-label="Title safe-area anchor" value={style.placement}
            onChange={event => changeStyle({ placement: event.currentTarget.value as TimelineTitleStyle['placement'] })}>
            {CAPTION_PLACEMENTS.map(placement => <option key={placement} value={placement}>{placement[0]?.toUpperCase()}{placement.slice(1)}</option>)}
          </select></PropertyRow>
          <PropertyRow label="Position X"><input className="property-number-input" type="number" aria-label="Title position X" value={title.positionX}
            onChange={event => editor.editTitle(title.id, { positionX: Number(event.currentTarget.value) })} /></PropertyRow>
          <PropertyRow label="Position Y"><input className="property-number-input" type="number" aria-label="Title position Y" value={title.positionY}
            onChange={event => editor.editTitle(title.id, { positionY: Number(event.currentTarget.value) })} /></PropertyRow>
          <PropertyRow label="Start (s)"><TimingInput label="Title start in seconds" valueMs={title.timelineStartMs} onCommit={ms => editor.editTitle(title.id, { timelineStartMs: ms })} /></PropertyRow>
          <PropertyRow label="End (s)"><TimingInput label="Title end in seconds" valueMs={title.timelineEndMs} onCommit={ms => editor.editTitle(title.id, { timelineEndMs: ms })} /></PropertyRow>
        </PropertyGroup>
        <Button className="inspector-action caption-style-apply" disabled={automaticCount === 0} onClick={() => editor.applyTitleStyleToAutomaticCaptions(title.id)}>
          Apply appearance to {automaticCount} automatic caption{automaticCount === 1 ? '' : 's'}
        </Button>
      </>}
    </fieldset>
  </section>;
}
