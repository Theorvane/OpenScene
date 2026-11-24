import { describe, expect, it } from 'vitest';

import { buildShortsTimeline } from '../src/shared/shortsRecipe';
import type { LocalExportJob } from '../src/shared/exportTypes';
import type { ShortsJob, ShortsRecipe } from '../src/shared/shortsTypes';
import { DEFAULT_CLIP_EFFECTS, type MediaAsset } from '../src/shared/timelineTypes';
import {
  SHORTS_FIT_LABEL,
  activeSourceCaptionsAt,
  addShortsTitle,
  aggregateShortsExports,
  applyPresetToShortsTitles,
  canApplyResultAsyncResponse,
  computeContainScale,
  computeManualFillScale,
  computeShortsPreviewMediaStyle,
  filterSourceCaptionsForCandidate,
  formatShortsStageLabel,
  getPrimaryShortsClip,
  getShortsErrorGuidance,
  getShortsSelectionNotice,
  groupShortsRuns,
  isManualTransformModified,
  normalizeShortsStartBounds,
  pointerDeltaToOutputOffset,
  removeShortsTitle,
  shouldPollShortsJob,
  stepShortsClipRange,
  stepShortsTransformByKey,
  updateShortsClipSourceRange,
  updateShortsClipTransform,
  updateShortsTitle
} from '../src/renderer/src/editor/shorts/shortsReviewState';

const sampleAsset: MediaAsset = {
  id: 'asset-video-1',
  displayName: 'LongTalk.mp4',
  projectRelativePath: 'media/long.mp4',
  kind: 'video',
  mimeType: 'video/mp4',
  byteLength: 10_000,
  metadata: { durationMs: 90_000, width: 1920, height: 1080 },
  createdAt: '2026-11-24T00:00:00.000Z',
  updatedAt: '2026-11-24T00:00:00.000Z'
};

const sampleCaptions = [
  { id: 'c1', text: 'Opening hook sentence.', startMs: 10_000, endMs: 14_000 },
  { id: 'c2', text: 'Main punchline moment.', startMs: 14_500, endMs: 22_000 },
  { id: 'c3', text: 'Second topic later.', startMs: 40_000, endMs: 55_000 }
] as const;

const sampleRecipe: ShortsRecipe = {
  version: 1,
  sourceProjectId: 'proj-source',
  sourceAssetId: sampleAsset.id,
  sourceDurationMs: 90_000,
  sourceSha256: 'a'.repeat(64),
  sourceDimensions: { width: 1920, height: 1080 },
  candidate: {
    id: 'shorts:1:c1:c2',
    startMs: 10_000,
    endMs: 22_000,
    reason: 'Strong opening hook with complete payoff.',
    evidenceIds: ['c1', 'c2'],
    context: { completeThought: true, notes: 'Self-contained explanation.' }
  },
  evidenceSnapshot: sampleCaptions,
  output: { width: 1080, height: 1920, frameRate: 30, fit: 'contain' },
  createdAt: '2026-11-24T00:00:00.000Z'
};

function makeJob(overrides: Partial<ShortsJob>): ShortsJob {
  return {
    id: 'job-1',
    sourceProjectId: 'proj-source',
    sourceAssetId: sampleAsset.id,
    stage: 'review',
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
    cleanupComplete: true,
    items: [],
    ...overrides
  };
}

describe('shortsReviewState pure logic', () => {
  it('polls busy and uncleaned jobs but never auto-resumes interrupted jobs', () => {
    expect(shouldPollShortsJob(makeJob({ stage: 'transcribing', cleanupComplete: false }))).toBe(true);
    expect(shouldPollShortsJob(makeJob({ stage: 'selecting', cleanupComplete: false }))).toBe(true);
    expect(shouldPollShortsJob(makeJob({ stage: 'cancelling', cleanupComplete: false }))).toBe(true);
    expect(shouldPollShortsJob(makeJob({ stage: 'cancelled', cleanupComplete: false }))).toBe(true);
    expect(shouldPollShortsJob(makeJob({ stage: 'cancelled', cleanupComplete: true }))).toBe(false);
    expect(shouldPollShortsJob(makeJob({ stage: 'review', cleanupComplete: true }))).toBe(false);
    expect(
      shouldPollShortsJob(
        makeJob({ stage: 'failed', cleanupComplete: false, errorCode: 'interrupted' })
      )
    ).toBe(false);
    expect(formatShortsStageLabel('cancelling', false)).toContain('정리 중');
    expect(formatShortsStageLabel('cancelled', true)).toContain('정리 완료');
  });

  it('maps structured errorCodes to Settings guidance vs non-configuration errors', () => {
    expect(
      getShortsErrorGuidance(makeJob({ stage: 'failed', failureKind: 'configuration', errorCode: 'transcription_not_configured' }))
    ).toMatchObject({ openSettings: true, tone: 'warning' });

    expect(
      getShortsErrorGuidance(makeJob({ stage: 'failed', failureKind: 'configuration', errorCode: 'llm_not_configured' }))
    ).toMatchObject({ openSettings: true, tone: 'warning' });

    expect(
      getShortsErrorGuidance(makeJob({ stage: 'failed', failureKind: 'provider', errorCode: 'provider_failed' }))
    ).toMatchObject({ openSettings: false, tone: 'danger' });

    expect(
      getShortsErrorGuidance(makeJob({ stage: 'failed', cleanupComplete: false, errorCode: 'interrupted' }))
    ).toMatchObject({ openSettings: false, tone: 'warning' });
  });

  it('distinguishes insufficient-evidence for both 0 candidates and partial candidates', () => {
    const empty = getShortsSelectionNotice(
      makeJob({
        stage: 'review',
        selection: { status: 'insufficient-evidence', candidates: [], warnings: ['No speech found.'] }
      })
    );
    expect(empty).toMatchObject({ kind: 'empty', warnings: ['No speech found.'] });

    const partial = getShortsSelectionNotice(
      makeJob({
        stage: 'review',
        selection: {
          status: 'insufficient-evidence',
          candidates: [sampleRecipe.candidate],
          warnings: ['Omitted overlapping candidate.']
        }
      })
    );
    expect(partial).toMatchObject({ kind: 'partial', warnings: ['Omitted overlapping candidate.'] });

    expect(
      getShortsSelectionNotice(
        makeJob({
          stage: 'review',
          selection: { status: 'completed', candidates: [sampleRecipe.candidate], warnings: [] }
        })
      )
    ).toBeNull();
  });

  it('filters source-ms captions for candidate previews and resolves active captions at source time', () => {
    const filtered = filterSourceCaptionsForCandidate(sampleCaptions, sampleRecipe.candidate);
    expect(filtered.map((item) => [item.cue.id, item.relativeStartMs, item.relativeEndMs])).toEqual([
      ['c1', 0, 4000],
      ['c2', 4500, 12000]
    ]);
    expect(activeSourceCaptionsAt(sampleCaptions, 12_000).map((c) => c.id)).toEqual(['c1']);
    expect(activeSourceCaptionsAt(sampleCaptions, 14_250)).toEqual([]);
  });

  it('groups parent review runs with child/retry export runs and preserves prior completed exports on retry', () => {
    const reviewJob = makeJob({
      id: 'review-1',
      stage: 'completed',
      items: [
        { candidateId: 'cand-1', status: 'ready', resultProjectId: 'res-1' },
        { candidateId: 'cand-2', status: 'ready', resultProjectId: 'res-2' }
      ]
    });
    const exportRun1 = makeJob({
      id: 'exp-run-1',
      parentJobId: 'review-1',
      stage: 'partial',
      createdAt: '2026-11-24T00:01:00.000Z',
      items: [
        { candidateId: 'cand-1', status: 'completed', resultProjectId: 'res-1', exportJobId: 'ex-1' },
        { candidateId: 'cand-2', status: 'failed', resultProjectId: 'res-2', exportJobId: 'ex-2', error: 'FFmpeg failed.' }
      ]
    });
    const retryRun2 = makeJob({
      id: 'exp-run-2',
      parentJobId: 'exp-run-1',
      stage: 'completed',
      createdAt: '2026-11-24T00:02:00.000Z',
      items: [
        { candidateId: 'cand-2', status: 'completed', resultProjectId: 'res-2', exportJobId: 'ex-3' }
      ]
    });

    const grouped = groupShortsRuns([retryRun2, exportRun1, reviewJob]);
    expect(grouped.reviewRuns.map((r) => r.id)).toEqual(['review-1']);
    expect(grouped.exportRunsByRootId['review-1']?.map((r) => r.id)).toEqual(['exp-run-1', 'exp-run-2']);

    const exportJobsById: Record<string, LocalExportJob> = {
      'ex-1': {
        id: 'ex-1',
        projectId: 'res-1',
        createdAt: '2026-11-24T00:01:00.000Z',
        updatedAt: '2026-11-24T00:01:05.000Z',
        state: { kind: 'completed', completedAt: '2026-11-24T00:01:05.000Z', fileName: 'short-1.mp4', fileSizeBytes: 1024 }
      }
    };

    // Before retry completes, only cand-2 is in failedResultProjectIds while cand-1 stays completed.
    const partialSummary = aggregateShortsExports({
      reviewJob,
      exportRuns: [exportRun1],
      exportJobsById,
      unavailableExportJobIds: new Set()
    });
    expect(partialSummary.completedCount).toBe(1);
    expect(partialSummary.failedResultProjectIds).toEqual(['res-2']);
    expect(partialSummary.items[0]).toMatchObject({ status: 'completed', completedExportJobId: 'ex-1', canOpen: true });

    // After retry completes (with ex-1 unavailable from an earlier restart), cand-1 stays completed without crashing.
    const finalSummary = aggregateShortsExports({
      reviewJob,
      exportRuns: [exportRun1, retryRun2],
      exportJobsById: {},
      unavailableExportJobIds: new Set(['ex-1'])
    });
    expect(finalSummary.completedCount).toBe(2);
    expect(finalSummary.failedResultProjectIds).toEqual([]);
    expect(finalSummary.items[0]).toMatchObject({ status: 'completed', exportJobUnavailable: true, canOpen: false });
    expect(finalSummary.items[1]).toMatchObject({ status: 'completed', completedExportJobId: 'ex-3', canOpen: true });
  });

  it('edits materialized short timeline trim, manual 9:16 transform, and subtitles via shared rules', () => {
    const timeline = buildShortsTimeline(sampleAsset, sampleRecipe);
    const clip = getPrimaryShortsClip(timeline);
    expect(clip).not.toBeNull();
    expect(SHORTS_FIT_LABEL).toContain('Contain');
    expect(SHORTS_FIT_LABEL).toContain('얼굴추적 미포함');

    // Trim start & end safely within source bounds.
    const stepped = stepShortsClipRange(clip!, 'start', 500);
    const trimmed = updateShortsClipSourceRange(timeline, { clipId: clip!.id, ...stepped });
    expect(trimmed).not.toBeNull();
    expect(getPrimaryShortsClip(trimmed!)?.sourceStartMs).toBe(10_500);
    expect(updateShortsClipSourceRange(timeline, { clipId: clip!.id, sourceStartMs: 22_000, sourceEndMs: 22_100 })).toBeNull();

    // Contain scale matches buildShortsTimeline (`min(1080/w, 1920/h, 2)`) including 2x cap for small sources.
    expect(computeContainScale(1920, 1080)).toBeCloseTo(1080 / 1920, 6);
    expect(computeContainScale(320, 180)).toBe(2);
    expect(isManualTransformModified(clip!.effects, 1920, 1080)).toBe(false);
    // Resetting via updateShortsClipTransform preserves 4-decimal 0.5625 precision without drifting from Contain.
    const resetBack = updateShortsClipTransform(trimmed!, clip!.id, {
      positionX: 0,
      positionY: 0,
      scale: computeContainScale(1920, 1080)
    });
    expect(getPrimaryShortsClip(resetBack!)?.effects.scale).toBe(0.5625);
    expect(isManualTransformModified(getPrimaryShortsClip(resetBack!)?.effects, 1920, 1080)).toBe(false);

    // Manual 9:16 transform via pointer drag & keyboard contract.
    const dragDelta = pointerDeltaToOutputOffset({
      deltaClientX: 27,
      deltaClientY: -54,
      viewportWidthPx: 270,
      viewportHeightPx: 480
    });
    expect(dragDelta).toEqual({ deltaPositionX: 108, deltaPositionY: -216 });

    const keyStep = stepShortsTransformByKey(DEFAULT_CLIP_EFFECTS, 'ArrowRight', true);
    expect(keyStep).toEqual({ positionX: 50 });
    expect(stepShortsTransformByKey(DEFAULT_CLIP_EFFECTS, '+', false)).toEqual({ scale: 1.05 });
    expect(
      stepShortsTransformByKey({ ...DEFAULT_CLIP_EFFECTS, positionX: 40, scale: 1.5 }, '0', false, computeContainScale(1920, 1080))
    ).toEqual({
      positionX: 0,
      positionY: 0,
      scale: 0.5625
    });

    const transformed = updateShortsClipTransform(trimmed!, clip!.id, {
      positionX: 100,
      positionY: -40,
      scale: computeManualFillScale(1920, 1080)
    });
    expect(transformed).not.toBeNull();
    const updatedEffects = getPrimaryShortsClip(transformed!)!.effects;
    expect(updatedEffects.positionX).toBe(100);
    expect(updatedEffects.scale).toBe(1.78);

    const previewStyle = computeShortsPreviewMediaStyle({
      effects: updatedEffects,
      viewportWidthPx: 270,
      viewportHeightPx: 480,
      sourceWidth: 1920,
      sourceHeight: 1080
    });
    expect(previewStyle.translateXPx).toBe(25);
    expect(previewStyle.translateYPx).toBe(-10);

    // Subtitle add/edit/preset/remove.
    const firstTitle = transformed!.titles![0]!;
    const editedTitle = updateShortsTitle(transformed!, firstTitle.id, { text: 'Edited Korean 자막' });
    expect(editedTitle?.titles?.[0]?.text).toBe('Edited Korean 자막');

    const withPreset = applyPresetToShortsTitles(editedTitle!, 'social');
    expect(withPreset.titles?.[0]?.color).toBe('#ffe14a');

    const withAdded = addShortsTitle(withPreset, { id: 'extra-cap', atMs: 12_000, text: 'Extra line' });
    expect(withAdded.titles?.some((t) => t.id === 'extra-cap')).toBe(true);

    const afterRemove = removeShortsTitle(withAdded, 'extra-cap');
    expect(afterRemove?.titles?.some((t) => t.id === 'extra-cap')).toBe(false);
  });

  it('validates requested count and duration bounds against Backend contract', () => {
    expect(normalizeShortsStartBounds({ requestedCount: 4, minDurationSeconds: 15, maxDurationSeconds: 60 })).toEqual({
      requestedCount: 4,
      minDurationMs: 15_000,
      maxDurationMs: 60_000
    });
    expect(normalizeShortsStartBounds({ requestedCount: 0, minDurationSeconds: 15, maxDurationSeconds: 60 })).toBeNull();
    expect(normalizeShortsStartBounds({ requestedCount: 6, minDurationSeconds: 15, maxDurationSeconds: 60 })).toBeNull();
    expect(normalizeShortsStartBounds({ requestedCount: 2, minDurationSeconds: 40, maxDurationSeconds: 20 })).toBeNull();
  });

  it('rejects stale or post-unmount async openProject/saveTimeline responses via revision & mounted guards', () => {
    expect(
      canApplyResultAsyncResponse({ mounted: true, currentRevision: 3, requestRevision: 3 })
    ).toBe(true);
    // Stale response after a newer inline edit bumped revision.
    expect(
      canApplyResultAsyncResponse({ mounted: true, currentRevision: 4, requestRevision: 3 })
    ).toBe(false);
    // Delayed response arriving after component unmount.
    expect(
      canApplyResultAsyncResponse({ mounted: false, currentRevision: 3, requestRevision: 3 })
    ).toBe(false);
    expect(
      canApplyResultAsyncResponse({ mounted: false, currentRevision: 4, requestRevision: 3 })
    ).toBe(false);
  });
});
