/** Viewport math shared by touch and browser canvas hosts. Coordinates are CSS/native points. */
export type CanvasCamera = { readonly x: number; readonly y: number; readonly zoom: number };
export type CanvasBounds = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
export const CANVAS_ZOOM_MIN = 0.2, CANVAS_ZOOM_MAX = 1.6;
export function zoomCanvasAt(camera: CanvasCamera, zoom: number, anchor: { x: number; y: number }): CanvasCamera {
  const next = Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, zoom));
  return { x: anchor.x - (anchor.x - camera.x) * next / camera.zoom, y: anchor.y - (anchor.y - camera.y) * next / camera.zoom, zoom: next };
}
export function fitCanvasBounds(bounds: CanvasBounds, width: number, height: number, padding = 28): CanvasCamera {
  const zoom = Math.min(1, Math.max(CANVAS_ZOOM_MIN, Math.min(Math.max(1, width - padding * 2) / Math.max(1, bounds.width), Math.max(1, height - padding * 2) / Math.max(1, bounds.height))));
  return { zoom, x: (width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (height - bounds.height * zoom) / 2 - bounds.y * zoom };
}
