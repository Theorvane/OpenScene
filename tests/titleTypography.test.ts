import { describe, expect, it } from 'vitest';
import { applyCaptionPreset, parseTimelineTitleStyle, LEGACY_TITLE_STYLE } from '../src/shared/captionStyle';
import { parseTitleFontRequest, parseTitleShadow, DEFAULT_TITLE_SHADOW } from '../src/shared/titleTypography';
import { compileFfmpegTimeline } from '../src/shared/ffmpegTimelineCompiler';
import { DEFAULT_CLIP_EFFECTS, TIMELINE_SCHEMA_VERSION } from '../src/shared/timelineTypes';
import { fontCandidates } from '../src/shared/titleFont';

describe('title font and shadow contract', () => {
  it('leaves legacy styles unchanged and accepts bounded new properties', () => {
    expect(parseTimelineTitleStyle(LEGACY_TITLE_STYLE)).toEqual(LEGACY_TITLE_STYLE);
    const styled = { ...LEGACY_TITLE_STYLE, fontFamily: 'serif', shadow: { ...DEFAULT_TITLE_SHADOW, opacity: 0.6, offsetX: -8, offsetY: 12 } };
    expect(parseTimelineTitleStyle(styled)).toEqual(styled);
    expect(parseTimelineTitleStyle({ ...styled, fontFamily: '/private/font.ttf' })).toBeNull();
    expect(parseTimelineTitleStyle({ ...styled, shadow: { ...styled.shadow, command: 'run' } })).toBeNull();
  });
  it.each([{ opacity: 2 }, { offsetX: 101 }, { offsetY: NaN }, { offsetX: 0.5 }, { color: 'red' }])('rejects invalid shadow settings %j', change => {
    expect(parseTitleShadow({ ...DEFAULT_TITLE_SHADOW, ...change })).toBeNull();
  });
  it('allows only a closed font family and weight, without paths', () => {
    expect(parseTitleFontRequest({ family: 'mono', weight: 'bold' })).toEqual({ family: 'mono', weight: 'bold' });
    for (const value of [{ family: '../fonts', weight: 'bold' }, { family: 'sans', weight: 'italic' }, { family: 'sans', weight: 'regular', path: 'x' }, null]) expect(parseTitleFontRequest(value)).toBeNull();
    expect(fontCandidates('win32', 'bold', 'serif')).toEqual(['C:\\Windows\\Fonts\\timesbd.ttf']);
    expect(fontCandidates('win32', 'regular', 'mono')).toEqual(['C:\\Windows\\Fonts\\consola.ttf']);
  });
  it('retains a selected font and shadow while changing a caption style preset', () => {
    const title = { id: 'title', text: '가', timelineStartMs: 0, timelineEndMs: 1000, sizePx: 52, color: '#ffffff', positionX: 0, positionY: 0,
      style: { ...LEGACY_TITLE_STYLE, fontFamily: 'korean' as const, shadow: { ...DEFAULT_TITLE_SHADOW, opacity: 0.7 } } };
    const next = applyCaptionPreset(title, 'boxed');
    expect(next.style.fontFamily).toBe('korean');
    expect(next.style.shadow).toEqual(title.style.shadow);
    expect(next.style.shadow).not.toBe(title.style.shadow);
  });
  it('uses the exact selected font and signed pixel offsets in final rendering', () => {
    const timeline = { schemaVersion: TIMELINE_SCHEMA_VERSION, tracks: [{ id: 'v', name: 'Video', kind: 'video' as const, clips: [{
      id: 'clip', assetId: 'media', timelineStartMs: 0, sourceStartMs: 0, sourceEndMs: 1000, sourceDurationMs: 1000, effects: DEFAULT_CLIP_EFFECTS, keyframes: []
    }] }], transitions: [], titles: [{
      id: 'test-title', text: 'Fonts', timelineStartMs: 0, timelineEndMs: 1000,
      sizePx: 52, color: '#ffffff', positionX: 0, positionY: 0,
      style: { ...LEGACY_TITLE_STYLE, fontFamily: 'mono' as const, fontWeight: 'bold' as const, shadow: { color: '#ff0000', opacity: 0.75, offsetX: -12, offsetY: 16 } }
    }] };
    const input = { timeline, assetPaths: new Map([['media', '/tmp/media.mp4']]), outputPath: '/tmp/output.mp4', width: 640, height: 360, frameRate: 30,
      titleFontPath: '/fonts/sans.ttf', titleFontPaths: new Map([['mono:bold' as const, '/fonts/exact-mono-bold.ttf']]) };
    const args = compileFfmpegTimeline(input).args.join(' ');
    expect(args).toContain("fontfile='/fonts/exact-mono-bold.ttf'");
    expect(args).toContain('shadowcolor=#ff0000@0.75:shadowx=-12:shadowy=16');
    expect(() => compileFfmpegTimeline({ ...input, titleFontPaths: new Map() })).toThrow('selected mono bold title font');
  });
});
