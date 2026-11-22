import { describe, expect, it } from 'vitest';
import { applyEditorOperations } from '../src/shared/editorOperations';
import { createInitialTimeline } from '../src/shared/timelineLogic';

const empty = createInitialTimeline();
const timeline = { ...empty, canvas: {
  blocks: [{ id: 'join', kind: 'video-sequence' as const, inputCount: 2, position: { x: 100, y: 100 } }],
  connections: []
} };

describe('atomic canvas disconnect validation', () => {
  it.each([undefined, -1, 2, 0.5, NaN, Infinity, '0'])('rejects invalid input %s even on an unconnected block', input => {
    const before = JSON.stringify(timeline);
    const result = applyEditorOperations(timeline, [
      { action: 'track.add', id: 'voice', kind: 'audio', name: 'Voice' },
      { action: 'canvas.disconnect', id: 'join', ...(input === undefined ? {} : { input }) }
    ]);
    expect(result.success).toBe(false);
    expect(JSON.stringify(timeline)).toBe(before);
  });
  it('accepts an existing empty input as an idempotent disconnect', () => {
    expect(applyEditorOperations(timeline, [{ action: 'canvas.disconnect', id: 'join', input: 1 }]).success).toBe(true);
  });
  it('does not require an input when removing a block', () => {
    const result = applyEditorOperations(timeline, [{ action: 'canvas.remove', id: 'join' }]);
    expect(result.success && result.timeline.canvas?.blocks).toEqual([]);
  });
});
