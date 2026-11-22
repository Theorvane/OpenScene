import { describe, expect, it } from 'vitest';
import { CANVAS_ZOOM_MAX, CANVAS_ZOOM_MIN, fitCanvasBounds, zoomCanvasAt } from '../src/shared/canvasViewport';
import { applyEditorOperations } from '../src/shared/editorOperations';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';
describe('canvas viewport', () => {
  it('moves source nodes through the same approved operation as block nodes, without changing clip times', () => {
    const timeline = { ...createInitialTimeline(), tracks: [{ id: 'video', name: 'Video', kind: 'video' as const, clips: [{ id: 'source', assetId: 'asset', timelineStartMs: 300, sourceStartMs: 0, sourceEndMs: 1000, sourceDurationMs: 1000, effects: { ...DEFAULT_CLIP_EFFECTS }, keyframes: [] }] }] };
    const result = applyEditorOperations(timeline, [{ action: 'canvas.move', id: 'source', x: 500, y: 800 }]);
    expect(result.success).toBe(true);
    if (result.success) { expect(result.timeline.canvas?.sourcePositions?.source).toEqual({ x: 500, y: 800 }); expect(result.timeline.tracks).toEqual(timeline.tracks); }
    expect(applyEditorOperations(timeline, [{ action: 'canvas.move', id: 'missing', x: 0, y: 0 }]).success).toBe(false);
    expect(applyEditorOperations(timeline, [{ action: 'canvas.move', id: 'source', x: -1, y: 0 }]).success).toBe(false);
  });
  it('keeps the graph point under a pinch anchor stationary', () => {
    const before = { x: -120, y: 40, zoom: 0.8 }, anchor = { x: 210, y: 330 };
    const next = zoomCanvasAt(before, 1.3, anchor);
    expect((anchor.x - next.x) / next.zoom).toBeCloseTo((anchor.x - before.x) / before.zoom);
    expect((anchor.y - next.y) / next.zoom).toBeCloseTo((anchor.y - before.y) / before.zoom);
  });
  it('centres an offset graph with padding inside a phone viewport', () => {
    const bounds = { x: 250, y: 400, width: 800, height: 500 }, next = fitCanvasBounds(bounds, 390, 620);
    expect(next.x + bounds.x * next.zoom).toBeGreaterThanOrEqual(28);
    expect(next.x + (bounds.x + bounds.width) * next.zoom).toBeLessThanOrEqual(362);
    expect(next.y + (bounds.y + bounds.height / 2) * next.zoom).toBeCloseTo(310);
  });
  it('bounds extreme zoom and handles an empty viewport without NaN', () => {
    const camera = { x: 0, y: 0, zoom: 1 }, anchor = { x: 0, y: 0 };
    expect(zoomCanvasAt(camera, 100, anchor).zoom).toBe(CANVAS_ZOOM_MAX);
    expect(zoomCanvasAt(camera, 0.001, anchor).zoom).toBe(CANVAS_ZOOM_MIN);
    expect(Object.values(fitCanvasBounds({ x: 0, y: 0, width: 0, height: 0 }, 0, 0)).every(Number.isFinite)).toBe(true);
  });
});
