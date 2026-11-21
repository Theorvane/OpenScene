import { useEffect, useState } from 'react';
import { resolvedTitleStyle } from '../../../shared/captionStyle';
import { unsupportedFontCharacters } from '../../../shared/fontGlyphCoverage';
import type { TimelineTitle } from '../../../shared/timelineTypes';
import { titleFontCssFamily, type TitleFontKey, type TitleFontRequest } from '../../../shared/titleTypography';

const faces = new Map<TitleFontKey, Promise<Uint8Array>>();
function loadFace(request: TitleFontRequest): Promise<Uint8Array> {
  const key: TitleFontKey = `${request.family}:${request.weight}`;
  const existing = faces.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const response = await window.videoTool.getTitleFontData(request);
    if (!response.ok) throw new Error(response.error.message);
    const bytes = Uint8Array.from(atob(response.value.base64), character => character.charCodeAt(0));
    const face = await new FontFace(titleFontCssFamily(request.family), bytes, { weight: request.weight === 'bold' ? '700' : '400' }).load();
    document.fonts.add(face);
    return bytes;
  })().catch((error: unknown) => { faces.delete(key); throw error; });
  faces.set(key, pending);
  return pending;
}
export function useTitleFontFaces(titles: readonly TimelineTitle[]): { readonly ready: boolean; readonly error: string | null } {
  const key = JSON.stringify(titles.map(title => [title.text, resolvedTitleStyle(title).fontFamily ?? 'sans', resolvedTitleStyle(title).fontWeight]));
  const [loaded, setLoaded] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setError(null);
    void Promise.all(titles.map(async title => {
      const style = resolvedTitleStyle(title);
      const bytes = await loadFace({ family: style.fontFamily ?? 'sans', weight: style.fontWeight });
      const missing = unsupportedFontCharacters(bytes, title.text);
      if (missing === null || missing.length) throw new Error('The selected font cannot render all title characters. Try Korean sans for Hangul.');
    }))
      .then(() => { if (current) setLoaded(key); })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Title font could not be loaded.'); });
    return () => { current = false; };
  }, [key]);
  return { ready: key === loaded && error === null, error };
}
