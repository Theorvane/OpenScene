import { describe, expect, it } from 'vitest';
import { resolveVideoInspectionRange, sampleVideoInspectionSeconds } from '../src/shared/videoInspectionRange';

describe('video inspection ranges', () => {
  it('limits a window to twenty seconds and starts the next window at its end', () => {
    const first = resolveVideoInspectionRange(45_000, 5_000);
    expect(first).toEqual({ startMs: 5_000, endMs: 25_000 });
    expect(resolveVideoInspectionRange(45_000, first!.endMs)).toEqual({ startMs: 25_000, endMs: 45_000 });
  });

  it('samples the center of each second and the partial final second within the source', () => {
    const range = resolveVideoInspectionRange(2_250, 0, 8_000);
    expect(sampleVideoInspectionSeconds(range!)).toEqual([500, 1500, 2125]);
    expect(resolveVideoInspectionRange(2_250, 2_250)).toBeNull();
  });
});
