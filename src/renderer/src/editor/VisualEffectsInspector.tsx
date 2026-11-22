import type { ReactElement } from 'react';
import { selectedVisualEffect, VISUAL_EFFECT_PRESETS, visualEffectValues } from '../../../shared/visualEffectPresets';
import { PropertyGroup, PropertyRow } from './InspectorControls';
import type { TimelineEditorController } from './useTimelineEditor';

export function VisualEffectsInspector({ editor }: { readonly editor: TimelineEditorController }): ReactElement {
  const selected = selectedVisualEffect(editor.selectedClip?.clip.effects ?? {});
  return <section aria-label="Visual effects">
    <PropertyGroup title="Effects" onReset={() => editor.updateSelectedClipEffects(visualEffectValues('original'))}>
      <p className="inspector-help">Choose a look, then adjust its strength. Changes apply to this clip.</p>
      <div className="effect-preset-grid" role="group" aria-label="Visual effect presets">
        {VISUAL_EFFECT_PRESETS.map(preset => {
          const values = visualEffectValues(preset.id);
          return <button key={preset.id} type="button" className="effect-preset" aria-label={`Apply ${preset.label} effect`}
            aria-pressed={selected?.id === preset.id} title={preset.description}
            onClick={() => editor.updateSelectedClipEffects(values)}>
            <span className="effect-preset__scene" aria-hidden="true" style={{ filter: `brightness(${1 + values.brightness}) contrast(${values.contrast}) saturate(${values.saturation})` }}><i /><b /></span>
            <span>{preset.label}</span>
          </button>;
        })}
      </div>
      <PropertyRow label="Strength">
        <input className="property-slider" type="range" aria-label="Effect strength" min={0} max={100} step={1}
          disabled={!selected || selected.id === 'original'} value={selected ? Math.round(selected.amount * 100) : 100}
          onChange={event => { if (selected) editor.updateSelectedClipEffects(visualEffectValues(selected.id, Number(event.currentTarget.value) / 100)); }} />
        <span className="property-value-chip">{selected ? `${Math.round(selected.amount * 100)}%` : 'Custom'}</span>
      </PropertyRow>
      <p className="inspector-help">{selected ? VISUAL_EFFECT_PRESETS.find(preset => preset.id === selected.id)?.description : 'Custom colour settings. Choose a preset to adjust its strength.'}</p>
    </PropertyGroup>
  </section>;
}
