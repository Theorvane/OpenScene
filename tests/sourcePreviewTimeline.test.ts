import { describe, expect, it } from 'vitest';
import { buildSourcePreviewTracks, sourcePreviewCaptions } from '../src/shared/sourcePreviewTimeline';

describe('source component lanes', () => {
  it('aligns video, embedded sound and actual caption intervals to the full source clock', () => {
    const tracks = buildSourcePreviewTracks({ durationMs: 10000, fileName: 'Take', audioStatus: 'present', captions: [
      { id: 'b', text: 'World', startMs: 8000, endMs: 12000 },
      { id: 'a', text: 'Hello', startMs: 2000, endMs: 4000 },
      { id: 'outside', text: 'Skip', startMs: 11000, endMs: 12000 }
    ] });
    expect(tracks.map(track => track.kind)).toEqual(['video', 'audio', 'subtitle']);
    expect(tracks[0]?.segments[0]).toMatchObject({ startMs: 0, endMs: 10000, leftPercent: 0, widthPercent: 100 });
    expect(tracks[1]?.segments[0]).toMatchObject({ startMs: 0, endMs: 10000 });
    expect(tracks[2]?.segments).toEqual([
      { id: 'a', label: 'Hello', startMs: 2000, endMs: 4000, leftPercent: 20, widthPercent: 20 },
      { id: 'b', label: 'World', startMs: 8000, endMs: 10000, leftPercent: 80, widthPercent: 20 }
    ]);
  });
  it('keeps unavailable or unconfirmed streams empty without inventing media or caption data', () => {
    const tracks = buildSourcePreviewTracks({ durationMs: 10000, fileName: 'Silent', audioStatus: 'unknown', captions: [] });
    expect(tracks[1]).toMatchObject({ segments: [], emptyReason: 'audio-unknown' });
    expect(tracks[2]).toMatchObject({ segments: [], emptyReason: 'no-captions' });
    expect(buildSourcePreviewTracks({ durationMs: 10000, fileName: 'Silent', audioStatus: 'absent', captions: [] })[1]?.emptyReason).toBe('no-audio');
    expect(buildSourcePreviewTracks({ durationMs: NaN, fileName: 'Pending', audioStatus: 'present', captions: [] }).every(track => track.segments.length === 0)).toBe(true);
  });
  it('does not show captions from another project or another source selection', () => {
    const captions = [{ id: 'a', text: 'Hello', startMs: 1000, endMs: 2000 }];
    const snapshot = { projectId: 'p', assetId: 'a', captions };
    expect(sourcePreviewCaptions(snapshot, 'p', 'a')).toBe(captions);
    expect(sourcePreviewCaptions(snapshot, 'other', 'a')).toEqual([]);
    expect(sourcePreviewCaptions(snapshot, 'p', 'other')).toEqual([]);
  });
});
