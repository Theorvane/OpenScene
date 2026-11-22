export const TITLE_FONT_FAMILIES = ['sans', 'serif', 'mono', 'korean'] as const;
export type TitleFontFamily = (typeof TITLE_FONT_FAMILIES)[number];
export type TitleFontWeight = 'regular' | 'bold';
export type TitleFontKey = `${TitleFontFamily}:${TitleFontWeight}`;
export const TITLE_FONT_LABELS: Readonly<Record<TitleFontFamily, string>> = { sans: 'Sans serif', serif: 'Serif', mono: 'Monospace', korean: 'Korean sans' };
export type TitleShadow = { readonly color: string; readonly opacity: number; readonly offsetX: number; readonly offsetY: number };
export const DEFAULT_TITLE_SHADOW: TitleShadow = Object.freeze({ color: '#000000', opacity: 0, offsetX: 4, offsetY: 4 });
export type TitleFontRequest = { readonly family: TitleFontFamily; readonly weight: TitleFontWeight };
export type TitleFontData = TitleFontRequest & { readonly base64: string };

export function isTitleFontFamily(value: unknown): value is TitleFontFamily {
  return TITLE_FONT_FAMILIES.some(family => family === value);
}
export function parseTitleFontRequest(value: unknown): TitleFontRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).length === 2 && isTitleFontFamily(request.family) && (request.weight === 'regular' || request.weight === 'bold')
    ? { family: request.family, weight: request.weight } : null;
}
export function parseTitleShadow(value: unknown): TitleShadow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const shadow = value as Record<string, unknown>;
  if (Object.keys(shadow).length !== 4 || typeof shadow.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(shadow.color)
    || typeof shadow.opacity !== 'number' || !Number.isFinite(shadow.opacity) || shadow.opacity < 0 || shadow.opacity > 1
    || typeof shadow.offsetX !== 'number' || !Number.isSafeInteger(shadow.offsetX) || Math.abs(shadow.offsetX) > 100
    || typeof shadow.offsetY !== 'number' || !Number.isSafeInteger(shadow.offsetY) || Math.abs(shadow.offsetY) > 100) return null;
  return { color: shadow.color, opacity: shadow.opacity, offsetX: shadow.offsetX, offsetY: shadow.offsetY };
}
export function titleFontCssFamily(family: TitleFontFamily): string { return `OpenScene ${family}`; }
export function titleFontNativeFamily(family: TitleFontFamily, platform: string): string {
  if (platform === 'ios') return family === 'serif' ? 'Georgia' : family === 'mono' ? 'Courier' : 'System';
  return family === 'serif' ? 'serif' : family === 'mono' ? 'monospace' : 'sans-serif';
}
export function titleShadowColor(shadow: TitleShadow): string {
  return `${shadow.color}${Math.round(shadow.opacity * 255).toString(16).padStart(2, '0')}`;
}
