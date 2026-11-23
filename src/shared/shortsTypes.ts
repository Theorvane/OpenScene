import type { OpenAiAuthMode, ReasoningEffort } from './openAiAuth';
import type { SubtitleCue } from './narrationPlan';
import type { ShortsCandidate, ShortsSelectionResult } from './shortsCandidateSelection';

/** All ranges are exact integer source milliseconds. No paths or credentials cross IPC. */
export type ShortsStartInput = {
  readonly projectId: string;
  readonly assetId: string;
  readonly modelId: string;
  readonly openAiAuthMode?: OpenAiAuthMode;
  readonly ollamaBaseUrl?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly requestedCount?: number;
  readonly minDurationMs?: number;
  readonly maxDurationMs?: number;
};
export type ShortsJobInput = { readonly jobId: string };
/** Calling this is the explicit approval of the selected candidates and transcript captions. */
export type ShortsMaterializeInput = ShortsJobInput & { readonly candidateIds: readonly string[] };
/** Separate explicit export action, after normal project editing/review. */
export type ShortsExportInput = ShortsJobInput & { readonly resultProjectIds: readonly string[] };
export type ShortsJobStage = 'transcribing' | 'selecting' | 'review' | 'creating' | 'exporting' | 'completed' | 'partial' | 'failed' | 'cancelling' | 'cancelled';
export type ShortsItem = {
  readonly candidateId: string;
  readonly status: 'creating' | 'ready' | 'exporting' | 'completed' | 'failed' | 'cancelled';
  readonly resultProjectId?: string;
  readonly exportJobId?: string;
  readonly error?: string;
};
export type ShortsJob = {
  readonly id: string;
  readonly sourceProjectId: string;
  readonly sourceAssetId: string;
  readonly stage: ShortsJobStage;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly cleanupComplete: boolean;
  readonly transcription?: { readonly jobId: string; readonly progressPercent: number; readonly status: string };
  readonly selection?: ShortsSelectionResult;
  readonly items: readonly ShortsItem[];
  readonly error?: string;
  readonly failureKind?: 'configuration' | 'transcription' | 'provider' | 'storage';
};
export type ShortsRecipe = {
  readonly version: 1;
  readonly sourceProjectId: string;
  readonly sourceAssetId: string;
  readonly sourceDurationMs: number;
  readonly candidate: ShortsCandidate;
  readonly evidenceSnapshot: readonly SubtitleCue[];
  readonly output: { readonly width: 1080; readonly height: 1920; readonly frameRate: 30; readonly fit: 'contain' };
  readonly createdAt: string;
};
