import { describe, expect, it } from 'vitest';
import { selectSourcePreviewAsset, sourcePreviewDurationMs, sourceTransportTargetMs } from '../src/shared/sourceMediaPreview';

describe('full source preview', () => {
  const assets = [{ id: 'still', kind: 'image' }, { id: 'first', kind: 'video' }, { id: 'second', kind: 'video' }];
  it('selects the imported video and falls back to the first video for reopened projects', () => {
    expect(selectSourcePreviewAsset(assets, 'second')?.id).toBe('second');
    expect(selectSourcePreviewAsset(assets, 'missing')?.id).toBe('first');
    expect(selectSourcePreviewAsset(assets, 'still')?.id).toBe('first');
    expect(selectSourcePreviewAsset([], null)).toBeNull();
  });
  it('uses decoded full duration when metadata is absent or stale, never inventing a range', () => {
    expect(sourcePreviewDurationMs(undefined, 12.345)).toBe(12345);
    expect(sourcePreviewDurationMs(1000, 12.345)).toBe(12345);
    expect(sourcePreviewDurationMs(9000, NaN)).toBe(9000);
    expect(sourcePreviewDurationMs(undefined, Infinity)).toBe(0);
  });
});

it('bounds transport jumps to the original source on both surfaces', () => {
  expect(sourceTransportTargetMs(2000, 10000, 'back')).toBe(0);
  expect(sourceTransportTargetMs(9000, 10000, 'forward')).toBe(10000);
  expect(sourceTransportTargetMs(6000, 10000, 'back')).toBe(1000);
  expect(sourceTransportTargetMs(6000, 10000, 'start')).toBe(0);
  expect(sourceTransportTargetMs(6000, 10000, 'end')).toBe(10000);
  expect(sourceTransportTargetMs(6000, NaN, 'end')).toBe(0);
});
