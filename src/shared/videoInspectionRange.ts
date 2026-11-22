export const VIDEO_INSPECTION_WINDOW_MS = 20_000;

export function resolveVideoInspectionRange(durationMs: number, startMs: number, endMs?: number) {
  const end = Math.min(endMs ?? durationMs, durationMs, startMs + VIDEO_INSPECTION_WINDOW_MS);
  if (!Number.isFinite(end) || !Number.isFinite(startMs) || startMs < 0 || end <= startMs) return null;
  return { startMs, endMs: end };
}

export function sampleVideoInspectionSeconds(range: { readonly startMs: number; readonly endMs: number }): number[] {
  return Array.from({ length: Math.ceil((range.endMs - range.startMs) / 1000) }, (_, index) => {
    const secondStartMs = range.startMs + index * 1000;
    return secondStartMs + Math.floor(Math.min(1000, range.endMs - secondStartMs) / 2);
  });
}
