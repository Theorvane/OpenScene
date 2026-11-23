import { planAutoClipEdit } from './autoClipPlan';
import { applyEditorOperations } from './editorOperations';
import { createInitialTimeline } from './timelineLogic';
import { applyTranscriptionCues } from './transcription';
import type { MediaAsset, TimelineDocument } from './timelineTypes';
import type { ShortsRecipe } from './shortsTypes';

/** Build a fresh editable timeline; never accepts the source project's timeline. */
export function buildShortsTimeline(asset: MediaAsset, recipe: ShortsRecipe): TimelineDocument {
  const { startMs, endMs } = recipe.candidate;
  if (asset.kind !== 'video' || !Number.isSafeInteger(recipe.sourceDurationMs) || recipe.sourceDurationMs <= 0 ||
    !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs || endMs > recipe.sourceDurationMs ||
    recipe.evidenceSnapshot.some(cue => !Number.isSafeInteger(cue.startMs) || !Number.isSafeInteger(cue.endMs) || cue.startMs < 0 || cue.endMs <= cue.startMs || cue.endMs > recipe.sourceDurationMs)) {
    throw new Error('Invalid source range or caption evidence.');
  }
  const timeline = createInitialTimeline();
  const plan = planAutoClipEdit(timeline, [asset], {
    assetId: asset.id, prefix: 'shorts', segments: [{ start_time: startMs / 1000, end_time: endMs / 1000 }]
  });
  if (!plan.success) throw new Error(plan.error);
  const edit = applyEditorOperations(timeline, plan.operations, [asset]);
  if (!edit.success) throw new Error(edit.error);
  const cues = recipe.evidenceSnapshot.filter(cue => cue.startMs < endMs && cue.endMs > startMs);
  if (cues.length === 0) return edit.timeline;
  return applyTranscriptionCues(edit.timeline, {
    id: 'shorts-captions', sourceAssetId: asset.id, engine: 'whisper.cpp', modelName: 'source-transcript',
    language: 'auto', createdAt: recipe.createdAt, status: 'approved', cues
  });
}
