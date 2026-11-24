import { planAutoClipEdit } from './autoClipPlan';
import { applyEditorOperations } from './editorOperations';
import { createInitialTimeline } from './timelineLogic';
import { applyTranscriptionCues } from './transcription';
import { CLIP_EFFECT_RANGES, type MediaAsset, type TimelineDocument } from './timelineTypes';
import type { ShortsRecipe } from './shortsTypes';

/** Build a fresh editable timeline; never accepts the source project's timeline. */
export function buildShortsTimeline(asset: MediaAsset, recipe: ShortsRecipe): TimelineDocument {
  const { startMs, endMs } = recipe.candidate;
  const { width, height } = recipe.sourceDimensions;
  if (asset.kind !== 'video' || !Number.isSafeInteger(recipe.sourceDurationMs) || recipe.sourceDurationMs <= 0 ||
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
    !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs || endMs > recipe.sourceDurationMs ||
    recipe.evidenceSnapshot.some(cue => !Number.isSafeInteger(cue.startMs) || !Number.isSafeInteger(cue.endMs) || cue.startMs < 0 || cue.endMs <= cue.startMs || cue.endMs > recipe.sourceDurationMs)) {
    throw new Error('Invalid source range or caption evidence.');
  }
  const timeline = createInitialTimeline();
  const plan = planAutoClipEdit(timeline, [asset], {
    assetId: asset.id, prefix: 'shorts', segments: [{ start_time: startMs / 1000, end_time: endMs / 1000 }]
  });
  if (!plan.success) throw new Error(plan.error);
  // The existing compiler scales source pixels, then centers them on the output.
  // Keep its persisted effect rule and 2x editor limit; never silently crop a wide source.
  const scale = Math.min(recipe.output.width / width, recipe.output.height / height, CLIP_EFFECT_RANGES.scale.max);
  const edit = applyEditorOperations(timeline, [...plan.operations, { action: 'clip.effects', clipId: 'shorts:clip:0', effects: { scale } }], [asset]);
  if (!edit.success) throw new Error(edit.error);
  const cues = recipe.evidenceSnapshot.filter(cue => cue.startMs < endMs && cue.endMs > startMs);
  if (cues.length === 0) return edit.timeline;
  return applyTranscriptionCues(edit.timeline, {
    id: 'shorts-captions', sourceAssetId: asset.id, engine: 'whisper.cpp', modelName: 'source-transcript',
    language: 'auto', createdAt: recipe.createdAt, status: 'approved', cues
  });
}
