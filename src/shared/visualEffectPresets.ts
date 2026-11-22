import type { ClipEffects } from './timelineTypes';

type ColourAdjustment = Required<Pick<ClipEffects, 'brightness' | 'contrast' | 'saturation'>>;
export const VISUAL_EFFECT_PRESETS = [
  { id: 'original', label: 'Original', description: 'Neutral colour adjustments.', brightness: 0, contrast: 1, saturation: 1 },
  { id: 'monochrome', label: 'Black & white', description: 'Remove colour while preserving brightness.', brightness: 0, contrast: 1, saturation: 0 },
  { id: 'vivid', label: 'Vivid', description: 'Stronger colour and a little more contrast.', brightness: 0, contrast: 1.15, saturation: 1.35 },
  { id: 'soft', label: 'Soft', description: 'Gentler contrast with a lighter picture.', brightness: 0.06, contrast: 0.85, saturation: 0.9 },
  { id: 'dramatic', label: 'Dramatic', description: 'Deeper shadows and stronger contrast.', brightness: -0.04, contrast: 1.35, saturation: 0.85 },
  { id: 'faded', label: 'Faded', description: 'Lifted shadows and restrained colour.', brightness: 0.08, contrast: 0.75, saturation: 0.65 }
] as const;
export type VisualEffectPresetId = (typeof VISUAL_EFFECT_PRESETS)[number]['id'];

/** Persist measured colour values, so every existing preview and exporter uses the same look. */
export function visualEffectValues(id: VisualEffectPresetId, amount = 1): ColourAdjustment {
  const preset = VISUAL_EFFECT_PRESETS.find(entry => entry.id === id);
  if (!preset || !Number.isFinite(amount) || amount < 0 || amount > 1) throw new Error('Invalid visual effect preset or amount.');
  return { brightness: amount === 0 ? 0 : preset.brightness * amount, contrast: 1 + (preset.contrast - 1) * amount, saturation: 1 + (preset.saturation - 1) * amount };
}

/** Derive selection from saved values, including Undo and edits made on the other surface. */
export function selectedVisualEffect(effects: Partial<ClipEffects>): { readonly id: VisualEffectPresetId; readonly amount: number } | null {
  const actual = { brightness: effects.brightness ?? 0, contrast: effects.contrast ?? 1, saturation: effects.saturation ?? 1 };
  for (const preset of VISUAL_EFFECT_PRESETS) {
    const component = (['brightness', 'contrast', 'saturation'] as const).find(key => preset[key] !== (key === 'brightness' ? 0 : 1));
    const baseline = component === 'brightness' ? 0 : 1;
    const amount = component ? (actual[component] - baseline) / (preset[component] - baseline) : 1;
    if (amount <= 0 || amount > 1 + 1e-6) continue;
    const bounded = Math.min(1, amount);
    const expected = visualEffectValues(preset.id, bounded);
    if ((Object.keys(expected) as (keyof ColourAdjustment)[]).every(key => Math.abs(expected[key] - actual[key]) < 1e-6)) return { id: preset.id, amount: bounded };
  }
  return null;
}
