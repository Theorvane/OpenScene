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
