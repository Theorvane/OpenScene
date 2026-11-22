import type { CanvasBlockKind } from './videoCanvasGraph';

/** Shared library copy and categories; both surfaces use the same editing vocabulary. */
export type CanvasSetting = { readonly label: string; readonly default: number | string; readonly min?: number; readonly max?: number; readonly step?: number; readonly options?: readonly string[] };
export const CANVAS_BLOCK_CATALOG: Readonly<Record<CanvasBlockKind, { category: 'Video' | 'Audio' | 'Compose' | 'Edit'; description: string; inputs?: number; settings?: Readonly<Record<string, CanvasSetting>> }>> = {
  'video-sequence': { category: 'Video', description: 'Play video clips one after another.' },
  'audio-sequence': { category: 'Audio', description: 'Join voice or music clips in order.' },
  'audio-mix': { category: 'Audio', description: 'Layer voice, music and sound together.' },
  'video-audio': { category: 'Compose', description: 'Combine a video sequence with an audio output.', inputs: 2 },
  trim: { category: 'Edit', description: 'Keep a time range from video, audio or a combined output.', inputs: 1, settings: {
    startMs: { label: 'Start (ms)', default: 0, min: 0, max: 7200000, step: 100 }, endMs: { label: 'End (ms, 0 = end)', default: 0, min: 0, max: 7200000, step: 100 }
  } },
  speed: { category: 'Edit', description: 'Speed up or slow down video and audio together.', inputs: 1, settings: { rate: { label: 'Speed ×', default: 1, min: 0.25, max: 4, step: 0.25 } } },
  delay: { category: 'Edit', description: 'Start a clip or a whole branch later.', inputs: 1, settings: { delayMs: { label: 'Delay (ms)', default: 1000, min: 0, max: 7200000, step: 100 } } },
  look: { category: 'Video', description: 'Apply a colour look without changing sound.', inputs: 1, settings: {
    preset: { label: 'Look', default: 'vivid', options: ['original', 'monochrome', 'vivid', 'soft', 'dramatic', 'faded'] }, amount: { label: 'Strength', default: 1, min: 0, max: 1, step: 0.1 }
  } },
  volume: { category: 'Audio', description: 'Set the sound level of video, audio or a combined branch.', inputs: 1, settings: { volume: { label: 'Volume (0–1)', default: 0.5, min: 0, max: 1, step: 0.05 } } },
  transform: { category: 'Video', description: 'Position, resize, rotate or fade the picture.', inputs: 1, settings: {
    scale: { label: 'Scale ×', default: 1, min: 0, max: 2, step: 0.05 }, positionX: { label: 'Position X (px)', default: 0, min: -10000, max: 10000 }, positionY: { label: 'Position Y (px)', default: 0, min: -10000, max: 10000 }, rotation: { label: 'Rotation °', default: 0, min: 0, max: 360 }, opacity: { label: 'Opacity', default: 1, min: 0, max: 1, step: 0.05 }
  } },
  'video-overlay': { category: 'Compose', description: 'Put a smaller video over a background video.', inputs: 2, settings: {
    scale: { label: 'Overlay scale ×', default: 0.35, min: 0, max: 2, step: 0.05 }, positionX: { label: 'Overlay X (px)', default: 180, min: -10000, max: 10000 }, positionY: { label: 'Overlay Y (px)', default: 80, min: -10000, max: 10000 }, opacity: { label: 'Overlay opacity', default: 1, min: 0, max: 1, step: 0.05 }
  } },
  'video-mute': { category: 'Video', description: 'Remove embedded video sound, keeping any separate audio.', inputs: 1 }
};

export function canvasDefaultInputCount(kind: CanvasBlockKind): number { return CANVAS_BLOCK_CATALOG[kind].inputs ?? 2; }
export function canvasVariableInputs(kind: CanvasBlockKind): boolean { return CANVAS_BLOCK_CATALOG[kind].inputs === undefined; }
export function canvasSettings(block: { readonly kind: CanvasBlockKind; readonly settings?: Readonly<Record<string, number | string>> }): Readonly<Record<string, number | string>> {
  return { ...Object.fromEntries(Object.entries(CANVAS_BLOCK_CATALOG[block.kind].settings ?? {}).map(([key, spec]) => [key, spec.default])), ...block.settings };
}
export function validCanvasSettings(kind: CanvasBlockKind, value: unknown): value is Readonly<Record<string, number | string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const specs = CANVAS_BLOCK_CATALOG[kind].settings ?? {};
  return Object.entries(value).every(([key, entry]) => {
    const spec = specs[key];
    return spec !== undefined && (spec.options ? typeof entry === 'string' && spec.options.includes(entry)
      : typeof entry === 'number' && Number.isFinite(entry) && entry >= (spec.min ?? -Infinity) && entry <= (spec.max ?? Infinity));
  });
}
