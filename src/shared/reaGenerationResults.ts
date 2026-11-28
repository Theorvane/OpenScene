import type { MediaAsset } from './timelineTypes';
export interface VerifiedGenerationResult {
  readonly jobId: string; readonly projectId: string; readonly sourceEpoch: string;
  readonly asset: MediaAsset; readonly label: 'generated' | 'local-render'; readonly durationMs: number;
}
export interface GenerationResultScope { readonly jobId: string; readonly projectId: string; readonly sourceEpoch: string }
export interface GenerationImportScope extends GenerationResultScope { readonly trackId: string; readonly atMs: number }
export interface PreparedGenerationImport { readonly result: VerifiedGenerationResult; readonly scope: GenerationImportScope; readonly operations: readonly unknown[] }
