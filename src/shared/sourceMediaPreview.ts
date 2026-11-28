/** Source inspection never creates or changes a timeline clip. */
export function selectSourcePreviewAsset<T extends { readonly id: string; readonly kind: string }>(
  assets: readonly T[], selectedAssetId: string | null
): T | null {
  return assets.find(asset => asset.id === selectedAssetId && asset.kind === 'video')
    ?? assets.find(asset => asset.kind === 'video') ?? null;
}

export function sourcePreviewDurationMs(metadataMs: number | undefined, decodedSeconds: number): number {
  if (Number.isFinite(decodedSeconds) && decodedSeconds > 0) return Math.round(decodedSeconds * 1000);
  return metadataMs !== undefined && Number.isFinite(metadataMs) && metadataMs > 0 ? Math.round(metadataMs) : 0;
}

export type SourceTransportAction = 'start' | 'back' | 'forward' | 'end';
export function sourceTransportTargetMs(positionMs: number, durationMs: number, action: SourceTransportAction): number {
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const position = Number.isFinite(positionMs) ? Math.max(0, Math.min(positionMs, duration)) : 0;
  const target = action === 'start' ? 0 : action === 'end' ? duration : position + (action === 'back' ? -5000 : 5000);
  return Math.max(0, Math.min(duration, target));
}
