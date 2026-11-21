import { describe, expect, it } from 'vitest';
import { selectedVisualEffect, VISUAL_EFFECT_PRESETS, visualEffectValues } from '../src/shared/visualEffectPresets';

describe('shared visual effect presets', () => {
  it('interpolates toward neutral without changing other clip properties', () => {
    expect(visualEffectValues('monochrome', 0.5)).toEqual({ brightness: 0, contrast: 1, saturation: 0.5 });
    expect(visualEffectValues('dramatic', 0)).toEqual({ brightness: 0, contrast: 1, saturation: 1 });
    expect(Object.keys(visualEffectValues('vivid'))).toEqual(['brightness', 'contrast', 'saturation']);
  });
  it('recognizes saved presets and strength after reopening or undo', () => {
    for (const preset of VISUAL_EFFECT_PRESETS) {
      for (const amount of [0.25, 0.5, 1]) {
        const saved = visualEffectValues(preset.id, amount);
        expect(selectedVisualEffect(saved)).toEqual({ id: preset.id, amount: preset.id === 'original' ? 1 : expect.closeTo(amount, 6) });
      }
    }
    expect(selectedVisualEffect({})).toEqual({ id: 'original', amount: 1 });
    expect(selectedVisualEffect({ brightness: 0.33, contrast: 1.11, saturation: 0.7 })).toBeNull();
  });
  it.each([NaN, Infinity, -0.1, 1.1])('rejects an invalid amount %s', amount => {
    expect(() => visualEffectValues('vivid', amount)).toThrow();
  });
});
