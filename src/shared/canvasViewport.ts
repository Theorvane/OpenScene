/** Viewport math shared by touch and browser canvas hosts. Coordinates are CSS/native points. */
export type CanvasCamera = { readonly x: number; readonly y: number; readonly zoom: number };
export type CanvasBounds = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
export type CanvasTouch = { readonly id: string | number; readonly x: number; readonly y: number };
export type CanvasGesture = { readonly camera: CanvasCamera; readonly touches: readonly CanvasTouch[] };

/** Rebase on contact changes so RN's cumulative dx/dy cannot jump after a pinch. */
export function beginCanvasGesture(camera: CanvasCamera, touches: readonly CanvasTouch[]): CanvasGesture {
  return { camera: { ...camera }, touches: touches.slice(0, 2).map(touch => ({ ...touch })) };
}
export function moveCanvasGesture(gesture: CanvasGesture | null, camera: CanvasCamera, touches: readonly CanvasTouch[]): { gesture: CanvasGesture; camera: CanvasCamera } {
  const active = touches.slice(0, 2);
  if (!gesture || active.length !== gesture.touches.length || active.some(touch => !gesture.touches.some(before => before.id === touch.id))) {
    return { gesture: beginCanvasGesture(camera, active), camera };
  }
  const [a, b] = gesture.touches;
  if (!a) return { gesture, camera };
  const nextA = active.find(touch => touch.id === a.id)!;
  if (!b) return { gesture, camera: { ...gesture.camera, x: gesture.camera.x + (nextA.x - a.x), y: gesture.camera.y + (nextA.y - a.y) } };
  const nextB = active.find(touch => touch.id === b.id)!;
  const anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const zoomed = zoomCanvasAt(gesture.camera, gesture.camera.zoom * Math.hypot(nextB.x - nextA.x, nextB.y - nextA.y) / Math.max(1, distance), anchor);
  return { gesture, camera: { ...zoomed, x: zoomed.x + (nextA.x + nextB.x) / 2 - anchor.x, y: zoomed.y + (nextA.y + nextB.y) / 2 - anchor.y } };
}
export const CANVAS_ZOOM_MIN = 0.2, CANVAS_ZOOM_MAX = 1.6;
export function zoomCanvasAt(camera: CanvasCamera, zoom: number, anchor: { x: number; y: number }): CanvasCamera {
  const next = Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, zoom));
  return { x: anchor.x - (anchor.x - camera.x) * next / camera.zoom, y: anchor.y - (anchor.y - camera.y) * next / camera.zoom, zoom: next };
}
export function fitCanvasBounds(bounds: CanvasBounds, width: number, height: number, padding = 28): CanvasCamera {
  const zoom = Math.min(1, Math.max(CANVAS_ZOOM_MIN, Math.min(Math.max(1, width - padding * 2) / Math.max(1, bounds.width), Math.max(1, height - padding * 2) / Math.max(1, bounds.height))));
  return { zoom, x: (width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (height - bounds.height * zoom) / 2 - bounds.y * zoom };
}
