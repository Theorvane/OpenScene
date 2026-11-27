import { describe, expect, it } from 'vitest';
import { describeCanvasApplyImpact } from '../src/renderer/src/editor/canvasApplyImpact';
import { applyCanvasBlock } from '../src/shared/videoCanvasBlocks';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';

describe('canvas apply impact presentation', () => {
  it('compares the actual shared apply result with current manual clip edits without promising selective preservation', () => {
    const before = { ...createInitialTimeline(), tracks: [{ id: 'video', name: 'Video', kind: 'video' as const, clips: [{
      id: 'clip', assetId: 'asset', sourceDurationMs: 6000, sourceStartMs: 1000, sourceEndMs: 5000,
      timelineStartMs: 1200, effects: { ...DEFAULT_CLIP_EFFECTS, opacity: 0.5 }, keyframes: []
    }] }] };
    const result = applyCanvasBlock(before, {
      blocks: [{ id: 'trim', kind: 'trim', inputCount: 1, position: { x: 0, y: 0 }, settings: { startMs: 500, endMs: 2000 } }],
      connections: [{ fromId: 'clip', toId: 'trim', input: 0 }]
    }, 'trim');
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const summary = describeCanvasApplyImpact(before, result.timeline, 'Trim');
    expect(summary.items[0]?.targetLabel).toBe('기존 클립 1개 변경');
    expect(summary.items[0]?.detail).toContain('수동 편집 여부는 별도로 추적하지 않습니다');
    expect(summary.preserveManualCaptions).toBe(false);
    expect(before.tracks[0]?.clips[0]?.timelineStartMs).toBe(1200);
    expect(describeCanvasApplyImpact(before, before, 'Trim').items[0]?.targetLabel).toBe('기존 클립 0개 변경');
  });
});
