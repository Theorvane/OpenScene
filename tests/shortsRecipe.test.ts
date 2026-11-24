import { describe, expect, it } from 'vitest';
import { buildShortsTimeline } from '../src/shared/shortsRecipe';
import type { ShortsRecipe } from '../src/shared/shortsTypes';
import type { MediaAsset } from '../src/shared/timelineTypes';
const asset: MediaAsset = { id: 'copied', displayName: 'Copy', projectRelativePath: 'assets/copy.mp4', kind: 'video', mimeType: 'video/mp4', byteLength: 10,
  metadata: { durationMs: 10000, width: 3840, height: 2160 }, createdAt: '2026-11-24T00:00:00.000Z', updatedAt: '2026-11-24T00:00:00.000Z' };
const recipe: ShortsRecipe = { version: 1, sourceProjectId: 'source-project', sourceAssetId: 'original', sourceDurationMs: 10000, sourceSha256: 'a'.repeat(64),
  sourceDimensions: { width: 3840, height: 2160 }, candidate: { id: 'candidate', startMs: 2000, endMs: 4000, reason: 'Fixture cue', evidenceIds: ['cue'], context: { completeThought: true, notes: '' } },
  evidenceSnapshot: [{ id: 'cue', text: 'Original text retained.', startMs: 1000, endMs: 5000 }],
  output: { width: 1080, height: 1920, frameRate: 30, fit: 'contain' }, createdAt: '2026-11-24T00:00:00.000Z' };
describe('shorts editable recipe', () => {
  it('contains a large landscape source and clips/rebases straddling source captions', () => {
    const before = JSON.stringify({ asset, recipe });
    const timeline = buildShortsTimeline(asset, recipe);
    const clip = timeline.tracks.flatMap(track => track.clips)[0]!;
    expect(clip.effects.scale).toBe(1080 / 3840);
    expect(clip.effects.scale * 2160).toBeLessThanOrEqual(1920);
    expect(timeline.titles?.map(title => [title.text, title.timelineStartMs, title.timelineEndMs])).toEqual([['Original text retained.', 0, 2000]]);
    expect(JSON.stringify({ asset, recipe })).toBe(before);
  });
  it.each([[NaN, 4000], [-1, 4000], [4000, 4000], [2000, 10001], [2000.5, 4000]])('rejects invalid source range %s..%s', (startMs, endMs) => {
    expect(() => buildShortsTimeline(asset, { ...recipe, candidate: { ...recipe.candidate, startMs, endMs } })).toThrow();
  });
});
