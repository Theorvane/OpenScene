import { applyCaptionPreset, type CaptionPresetId } from '../../../../shared/captionStyle';
import type { LocalExportJob } from '../../../../shared/exportTypes';
import type { SubtitleCue } from '../../../../shared/narrationPlan';
import type { ShortsCandidate } from '../../../../shared/shortsCandidateSelection';
import type { ShortsItem, ShortsJob, ShortsJobStage, ShortsRecipe } from '../../../../shared/shortsTypes';
import { clipTimelineEndMs } from '../../../../shared/timelineClipGeometry';
import { updateClipEffects } from '../../../../shared/timelineLogic';
import { addTitle, removeTitle, updateTitle } from '../../../../shared/timelineTitleLogic';
import {
  CLIP_EFFECT_RANGES,
  DEFAULT_CLIP_EFFECTS,
  type ClipEffects,
  type PersistedTimelineClip,
  type TimelineDocument,
  type TimelineTitle
} from '../../../../shared/timelineTypes';
import { getExportProgressPercent } from '../exportUiState';

export const SHORTS_OUTPUT_WIDTH = 1080 as const;
export const SHORTS_OUTPUT_HEIGHT = 1920 as const;
export const SHORTS_OUTPUT_FRAME_RATE = 30 as const;
export const SHORTS_COUNT_MIN = 1 as const;
export const SHORTS_COUNT_MAX = 5 as const;
export const SHORTS_DEFAULT_COUNT = 4 as const;
export const SHORTS_MIN_DURATION_MS_DEFAULT = 15_000 as const;
export const SHORTS_MAX_DURATION_MS_DEFAULT = 60_000 as const;
export const SHORTS_MIN_CLIP_SPAN_MS = 500 as const;

export const SHORTS_FIT_LABEL = '9:16 캔버스 (Contain · 얼굴추적 미포함)';
export const SHORTS_MANUAL_TRANSFORM_LABEL = '수동 9:16 Transform (얼굴추적 미포함)';

const BUSY_STAGES: ReadonlySet<ShortsJobStage> = new Set([
  'transcribing',
  'selecting',
  'creating',
  'exporting',
  'cancelling'
]);

export function isShortsJobBusy(job: ShortsJob | null): boolean {
  if (job === null) return false;
  return BUSY_STAGES.has(job.stage);
}

/**
 * Poll while a run is actively working or waiting for cancellation/final cleanup.
 * Interrupted runs loaded from disk have `cleanupComplete: false` and `errorCode: 'interrupted'`
 * and are never resumed automatically, so polling must stop for them.
 */
export function shouldPollShortsJob(job: ShortsJob | null): boolean {
  if (job === null) return false;
  if (job.errorCode === 'interrupted') return false;
  return BUSY_STAGES.has(job.stage) || !job.cleanupComplete;
}

export type ShortsErrorGuidance = {
  readonly title: string;
  readonly detail: string;
  readonly openSettings: boolean;
  readonly tone: 'warning' | 'danger';
};

export function getShortsErrorGuidance(job: ShortsJob | null): ShortsErrorGuidance | null {
  if (job === null) return null;
  if (job.stage !== 'failed' && job.errorCode === undefined && job.error === undefined) return null;

  switch (job.errorCode) {
    case 'transcription_not_configured':
      return {
        title: '로컬 음성 전사(whisper.cpp) 설정 필요',
        detail: job.error ?? 'Settings에서 whisper.cpp 실행 파일과 모델을 설정한 뒤 다시 시도하세요.',
        openSettings: true,
        tone: 'warning'
      };
    case 'llm_not_configured':
      return {
        title: '모델 프로바이더 연결 필요',
        detail: job.error ?? 'Settings에서 선택한 AI 모델 프로바이더를 연결한 뒤 다시 시도하세요.',
        openSettings: true,
        tone: 'warning'
      };
    case 'transcription_failed':
      return {
        title: '로컬 음성 전사 실패',
        detail: job.error ?? '영상의 음성 전사에 실패했거나 음성이 감지되지 않았습니다.',
        openSettings: true,
        tone: 'danger'
      };
    case 'provider_failed':
      return {
        title: 'AI 후보 선정 실패',
        detail: job.error ?? '선택한 모델이 유효한 후보를 반환하지 못했습니다. 다른 모델로 재시도하세요.',
        openSettings: false,
        tone: 'danger'
      };
    case 'storage_failed':
      return {
        title: '로컬 저장소 오류',
        detail: job.error ?? '로컬 쇼츠 작업을 안전하게 완료하지 못했습니다.',
        openSettings: false,
        tone: 'danger'
      };
    case 'interrupted':
      return {
        title: '이전 실행이 중단됨 (자동 재개 안 함)',
        detail: job.error ?? '이전 실행이 완료 전에 중단되었습니다. 남아 있는 결과를 확인하거나 새 실행을 시작하세요.',
        openSettings: false,
        tone: 'warning'
      };
    default:
      if (job.stage !== 'failed') return null;
      return {
        title: '쇼츠 작업 실패',
        detail: job.error ?? '쇼츠 작업 중 오류가 발생했습니다.',
        openSettings: job.failureKind === 'configuration',
        tone: 'danger'
      };
  }
}

export type ShortsSelectionNotice = {
  readonly kind: 'empty' | 'partial';
  readonly title: string;
  readonly detail: string;
  readonly warnings: readonly string[];
};

/**
 * `insufficient-evidence` is a valid non-failure outcome when 0 candidates or fewer than
 * `requestedCount` grounded candidates were found.
 */
export function getShortsSelectionNotice(job: ShortsJob | null): ShortsSelectionNotice | null {
  const selection = job?.selection;
  if (selection === undefined || selection.status !== 'insufficient-evidence') return null;
  if (selection.candidates.length === 0) {
    return {
      kind: 'empty',
      title: '근거가 부족해 쇼츠 후보를 찾지 못했습니다',
      detail: '일반 오류가 아니라 영상 전사 근거에서 조건에 맞는 완결 구간이 부족한 상태입니다. 길이 범위를 조정하거나 다른 영상을 시도해 보세요.',
      warnings: selection.warnings
    };
  }
  return {
    kind: 'partial',
    title: `요청 수보다 적은 ${selection.candidates.length}개 후보만 추출되었습니다`,
    detail: '근거가 충분한 구간만 선정했습니다. 아래 후보를 검토하고 선택해 쇼츠 프로젝트를 생성할 수 있습니다.',
    warnings: selection.warnings
  };
}

export type ShortsCandidateCaptionPreview = {
  readonly cue: SubtitleCue;
  readonly relativeStartMs: number;
  readonly relativeEndMs: number;
};

/**
 * `job.captions` are exact integer original source milliseconds (not candidate-relative).
 */
export function filterSourceCaptionsForCandidate(
  captions: readonly SubtitleCue[] | undefined,
  candidate: Pick<ShortsCandidate, 'startMs' | 'endMs'>
): readonly ShortsCandidateCaptionPreview[] {
  if (captions === undefined || captions.length === 0) return [];
  const durationMs = Math.max(0, candidate.endMs - candidate.startMs);
  return captions
    .filter((cue) => cue.endMs > candidate.startMs && cue.startMs < candidate.endMs)
    .map((cue) => ({
      cue,
      relativeStartMs: Math.max(0, cue.startMs - candidate.startMs),
      relativeEndMs: Math.min(durationMs, Math.max(0, cue.endMs - candidate.startMs))
    }));
}

export function activeSourceCaptionsAt(
  captions: readonly SubtitleCue[] | undefined,
  sourceTimeMs: number
): readonly SubtitleCue[] {
  if (captions === undefined || captions.length === 0) return [];
  return captions.filter((cue) => sourceTimeMs >= cue.startMs && sourceTimeMs < cue.endMs);
}

export type ShortsGroupedRuns = {
  readonly reviewRuns: readonly ShortsJob[];
  readonly exportRunsByRootId: Readonly<Record<string, readonly ShortsJob[]>>;
};

export function groupShortsRuns(jobs: readonly ShortsJob[]): ShortsGroupedRuns {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const reviewRuns: ShortsJob[] = [];
  const exportBuckets = new Map<string, ShortsJob[]>();

  const findRootId = (job: ShortsJob): string => {
    let current: ShortsJob = job;
    const visited = new Set<string>([current.id]);
    while (current.parentJobId !== undefined) {
      const parent = byId.get(current.parentJobId);
      if (parent === undefined || visited.has(parent.id)) break;
      visited.add(parent.id);
      current = parent;
    }
    return current.id;
  };

  for (const job of jobs) {
    if (job.parentJobId === undefined) {
      reviewRuns.push(job);
    } else {
      const rootId = findRootId(job);
      const bucket = exportBuckets.get(rootId) ?? [];
      bucket.push(job);
      exportBuckets.set(rootId, bucket);
    }
  }

  reviewRuns.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const exportRunsByRootId: Record<string, readonly ShortsJob[]> = {};
  for (const [rootId, bucket] of exportBuckets.entries()) {
    exportRunsByRootId[rootId] = bucket.slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
  return { reviewRuns, exportRunsByRootId };
}

export type ShortsExportItemAggregate = {
  readonly candidateId: string;
  readonly resultProjectId: string;
  readonly status: 'ready' | 'exporting' | 'completed' | 'failed' | 'cancelled';
  readonly activeExportJobId?: string;
  readonly completedExportJobId?: string;
  readonly completedRunId?: string;
  readonly latestRunId?: string;
  readonly error?: string;
  readonly progressPercent: number;
  readonly exportJob?: LocalExportJob;
  readonly exportJobUnavailable: boolean;
  readonly canOpen: boolean;
  readonly canReveal: boolean;
};

export type ShortsExportAggregateSummary = {
  readonly items: readonly ShortsExportItemAggregate[];
  readonly latestExportRun: ShortsJob | null;
  readonly readyResultProjectIds: readonly string[];
  readonly failedResultProjectIds: readonly string[];
  readonly completedCount: number;
  readonly failedCount: number;
  readonly totalCount: number;
  readonly overallPercent: number;
  readonly isExporting: boolean;
  readonly isCancelling: boolean;
};

export function aggregateShortsExports(input: {
  readonly reviewJob: ShortsJob | null;
  readonly exportRuns: readonly ShortsJob[];
  readonly exportJobsById: Readonly<Record<string, LocalExportJob>>;
  readonly unavailableExportJobIds: ReadonlySet<string>;
}): ShortsExportAggregateSummary {
  const { reviewJob, exportRuns, exportJobsById, unavailableExportJobIds } = input;
  const orderedRuns = exportRuns.slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latestExportRun = orderedRuns.length > 0 ? orderedRuns[orderedRuns.length - 1]! : null;

  const materializedItems = (reviewJob?.items ?? []).filter(
    (item): item is ShortsItem & { readonly resultProjectId: string } => typeof item.resultProjectId === 'string' && item.resultProjectId.length > 0
  );

  const items: ShortsExportItemAggregate[] = materializedItems.map((baseItem) => {
    let status: ShortsExportItemAggregate['status'] = baseItem.status === 'ready' ? 'ready' : 'failed';
    let activeExportJobId: string | undefined;
    let completedExportJobId: string | undefined;
    let completedRunId: string | undefined;
    let latestRunId: string | undefined;
    let error: string | undefined = baseItem.error;

    for (const run of orderedRuns) {
      const match = run.items.find((entry) => entry.resultProjectId === baseItem.resultProjectId);
      if (match === undefined) continue;
      latestRunId = run.id;
      if (match.status === 'completed' && match.exportJobId !== undefined) {
        completedExportJobId = match.exportJobId;
        completedRunId = run.id;
        status = 'completed';
        activeExportJobId = match.exportJobId;
        error = undefined;
      } else if (completedExportJobId === undefined) {
        status = match.status === 'creating' ? 'ready' : match.status;
        activeExportJobId = match.exportJobId;
        error = match.error;
      } else if (match.status === 'exporting') {
        status = 'exporting';
        activeExportJobId = match.exportJobId;
      }
    }

    const effectiveJobId = activeExportJobId ?? completedExportJobId;
    const exportJob = effectiveJobId === undefined ? undefined : exportJobsById[effectiveJobId];
    const exportJobUnavailable = effectiveJobId !== undefined && unavailableExportJobIds.has(effectiveJobId);
    const resolvedError =
      status === 'failed'
        ? (exportJob?.state.kind === 'failed' && exportJob.state.reason.trim().length > 0
            ? exportJob.state.reason
            : error)
        : error;

    const progressPercent =
      status === 'completed'
        ? 100
        : exportJob !== undefined
          ? getExportProgressPercent(exportJob)
          : 0;

    // Opening/revealing requires a live completed exportJobId in the current session's ExportJobStore.
    const completedJobLive =
      completedExportJobId !== undefined &&
      !unavailableExportJobIds.has(completedExportJobId) &&
      (exportJobsById[completedExportJobId] === undefined || exportJobsById[completedExportJobId]?.state.kind === 'completed');

    return {
      candidateId: baseItem.candidateId,
      resultProjectId: baseItem.resultProjectId,
      status,
      ...(activeExportJobId === undefined ? {} : { activeExportJobId }),
      ...(completedExportJobId === undefined ? {} : { completedExportJobId }),
      ...(completedRunId === undefined ? {} : { completedRunId }),
      ...(latestRunId === undefined ? {} : { latestRunId }),
      ...(resolvedError === undefined ? {} : { error: resolvedError }),
      progressPercent,
      ...(exportJob === undefined ? {} : { exportJob }),
      exportJobUnavailable,
      canOpen: completedJobLive,
      canReveal: completedJobLive
    };
  });

  const totalCount = items.length;
  const completedCount = items.filter((item) => item.status === 'completed').length;
  const failedCount = items.filter((item) => item.status === 'failed' || item.status === 'cancelled').length;
  const overallPercent =
    totalCount === 0
      ? 0
      : Math.round(items.reduce((sum, item) => sum + item.progressPercent, 0) / totalCount);

  return {
    items,
    latestExportRun,
    readyResultProjectIds: items.map((item) => item.resultProjectId),
    failedResultProjectIds: items
      .filter((item) => item.status === 'failed' || item.status === 'cancelled')
      .map((item) => item.resultProjectId),
    completedCount,
    failedCount,
    totalCount,
    overallPercent,
    isExporting: latestExportRun !== null && (latestExportRun.stage === 'exporting' || (latestExportRun.stage === 'cancelling' && !latestExportRun.cleanupComplete)),
    isCancelling: latestExportRun !== null && latestExportRun.stage === 'cancelling' && !latestExportRun.cleanupComplete
  };
}

export function normalizeShortsStartBounds(input: {
  readonly requestedCount: number;
  readonly minDurationSeconds: number;
  readonly maxDurationSeconds: number;
}): { readonly requestedCount: number; readonly minDurationMs: number; readonly maxDurationMs: number } | null {
  if (!Number.isFinite(input.requestedCount) || !Number.isFinite(input.minDurationSeconds) || !Number.isFinite(input.maxDurationSeconds)) {
    return null;
  }
  const requestedCount = Math.round(input.requestedCount);
  const minDurationMs = Math.round(input.minDurationSeconds * 1000);
  const maxDurationMs = Math.round(input.maxDurationSeconds * 1000);
  if (
    requestedCount < SHORTS_COUNT_MIN ||
    requestedCount > SHORTS_COUNT_MAX ||
    minDurationMs <= 0 ||
    maxDurationMs < minDurationMs
  ) {
    return null;
  }
  return { requestedCount, minDurationMs, maxDurationMs };
}

export function getPrimaryShortsClip(timeline: TimelineDocument): PersistedTimelineClip | null {
  for (const track of timeline.tracks) {
    if (track.kind !== 'video') continue;
    const preferred = track.clips.find((clip) => clip.id === 'shorts:clip:0');
    if (preferred !== undefined) return preferred;
    if (track.clips.length > 0) return track.clips[0]!;
  }
  return null;
}

/**
 * Updates the materialized short's primary clip source window while preserving
 * `timelineStartMs: 0`, valid bounds `[0, sourceDurationMs]`, and minimum span.
 */
export function updateShortsClipSourceRange(
  timeline: TimelineDocument,
  input: { readonly clipId: string; readonly sourceStartMs: number; readonly sourceEndMs: number }
): TimelineDocument | null {
  const start = Math.round(input.sourceStartMs);
  const end = Math.round(input.sourceEndMs);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end - start < SHORTS_MIN_CLIP_SPAN_MS) {
    return null;
  }

  let changed = false;
  let invalid = false;
  const tracks = timeline.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      if (clip.id !== input.clipId) return clip;
      if (end > clip.sourceDurationMs) {
        invalid = true;
        return clip;
      }
      changed = true;
      const updatedClip: PersistedTimelineClip = {
        ...clip,
        timelineStartMs: 0,
        sourceStartMs: start,
        sourceEndMs: end
      };
      const maxEnd = clipTimelineEndMs(updatedClip);
      return {
        ...updatedClip,
        keyframes: clip.keyframes.filter((kf) => kf.timelineTimeMs >= 0 && kf.timelineTimeMs <= maxEnd)
      };
    })
  }));

  if (!changed || invalid) return null;
  return { ...timeline, tracks };
}

export function stepShortsClipRange(
  clip: Pick<PersistedTimelineClip, 'sourceStartMs' | 'sourceEndMs' | 'sourceDurationMs'>,
  edge: 'start' | 'end',
  deltaMs: number
): { readonly sourceStartMs: number; readonly sourceEndMs: number } {
  if (edge === 'start') {
    const maxStart = Math.max(0, clip.sourceEndMs - SHORTS_MIN_CLIP_SPAN_MS);
    const nextStart = Math.max(0, Math.min(maxStart, Math.round(clip.sourceStartMs + deltaMs)));
    return { sourceStartMs: nextStart, sourceEndMs: clip.sourceEndMs };
  }
  const minEnd = Math.min(clip.sourceDurationMs, clip.sourceStartMs + SHORTS_MIN_CLIP_SPAN_MS);
  const nextEnd = Math.max(minEnd, Math.min(clip.sourceDurationMs, Math.round(clip.sourceEndMs + deltaMs)));
  return { sourceStartMs: clip.sourceStartMs, sourceEndMs: nextEnd };
}

export function clampShortsTransform(
  effects: Partial<Pick<ClipEffects, 'positionX' | 'positionY' | 'scale'>>
): Partial<Pick<ClipEffects, 'positionX' | 'positionY' | 'scale'>> {
  const result: { positionX?: number; positionY?: number; scale?: number } = {};
  if (effects.positionX !== undefined && Number.isFinite(effects.positionX)) {
    result.positionX = Math.round(
      Math.max(CLIP_EFFECT_RANGES.positionX.min, Math.min(CLIP_EFFECT_RANGES.positionX.max, effects.positionX))
    );
  }
  if (effects.positionY !== undefined && Number.isFinite(effects.positionY)) {
    result.positionY = Math.round(
      Math.max(CLIP_EFFECT_RANGES.positionY.min, Math.min(CLIP_EFFECT_RANGES.positionY.max, effects.positionY))
    );
  }
  if (effects.scale !== undefined && Number.isFinite(effects.scale)) {
    const clamped = Math.max(0.1, Math.min(CLIP_EFFECT_RANGES.scale.max, effects.scale));
    result.scale = Math.round(clamped * 10_000) / 10_000;
  }
  return result;
}

export function updateShortsClipTransform(
  timeline: TimelineDocument,
  clipId: string,
  partial: Partial<Pick<ClipEffects, 'positionX' | 'positionY' | 'scale'>>
): TimelineDocument | null {
  const clamped = clampShortsTransform(partial);
  if (Object.keys(clamped).length === 0) return null;
  return updateClipEffects(timeline, { clipId, effects: clamped });
}

/**
 * Mirrors Backend `buildShortsTimeline` Contain scale: `min(1080/w, 1920/h, 2)`.
 * Keeps the 2x editor limit and preserves letterbox/pillarbox padding for small sources.
 */
export function computeContainScale(sourceWidth?: number, sourceHeight?: number): number {
  if (
    sourceWidth === undefined ||
    sourceHeight === undefined ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return 1;
  }
  return Math.min(SHORTS_OUTPUT_WIDTH / sourceWidth, SHORTS_OUTPUT_HEIGHT / sourceHeight, CLIP_EFFECT_RANGES.scale.max);
}

/**
 * Manual fill scale helper within existing `CLIP_EFFECT_RANGES.scale` (max 2.0).
 * Never performs automatic face tracking.
 */
export function computeManualFillScale(sourceWidth?: number, sourceHeight?: number): number {
  if (
    sourceWidth === undefined ||
    sourceHeight === undefined ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return 1.78;
  }
  const cover = Math.max(SHORTS_OUTPUT_WIDTH / sourceWidth, SHORTS_OUTPUT_HEIGHT / sourceHeight);
  return Math.round(Math.min(CLIP_EFFECT_RANGES.scale.max, Math.max(computeContainScale(sourceWidth, sourceHeight), cover)) * 100) / 100;
}

export function isManualTransformModified(
  effects: ClipEffects | null | undefined,
  sourceWidth?: number,
  sourceHeight?: number
): boolean {
  if (effects === null || effects === undefined) return false;
  const containScale = computeContainScale(sourceWidth, sourceHeight);
  return (
    effects.positionX !== DEFAULT_CLIP_EFFECTS.positionX ||
    effects.positionY !== DEFAULT_CLIP_EFFECTS.positionY ||
    Math.abs(effects.scale - containScale) > 0.005
  );
}

/**
 * Mirrors FFmpeg's `scale=w='iw*scale':h='ih*scale'` + `overlay=x='(main_w-overlay_w)/2+positionX':y='(main_h-overlay_h)/2+positionY'`
 * inside the 1080x1920 logical output frame scaled to the preview viewport's CSS pixel size.
 */
export function computeShortsPreviewMediaStyle(input: {
  readonly effects: ClipEffects;
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
  readonly sourceWidth?: number | undefined;
  readonly sourceHeight?: number | undefined;
}): {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly translateXPx: number;
  readonly translateYPx: number;
} {
  const outputScale =
    input.viewportWidthPx > 0 && input.viewportHeightPx > 0
      ? Math.min(input.viewportWidthPx / SHORTS_OUTPUT_WIDTH, input.viewportHeightPx / SHORTS_OUTPUT_HEIGHT)
      : 0;
  const sourceW = input.sourceWidth && input.sourceWidth > 0 ? input.sourceWidth : SHORTS_OUTPUT_WIDTH;
  const sourceH = input.sourceHeight && input.sourceHeight > 0 ? input.sourceHeight : 608;
  return {
    widthPx: sourceW * input.effects.scale * outputScale,
    heightPx: sourceH * input.effects.scale * outputScale,
    translateXPx: input.effects.positionX * outputScale,
    translateYPx: input.effects.positionY * outputScale
  };
}

export function pointerDeltaToOutputOffset(input: {
  readonly deltaClientX: number;
  readonly deltaClientY: number;
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
}): { readonly deltaPositionX: number; readonly deltaPositionY: number } {
  const outputScale =
    input.viewportWidthPx > 0 && input.viewportHeightPx > 0
      ? Math.min(input.viewportWidthPx / SHORTS_OUTPUT_WIDTH, input.viewportHeightPx / SHORTS_OUTPUT_HEIGHT)
      : 1;
  if (outputScale <= 0) return { deltaPositionX: 0, deltaPositionY: 0 };
  return {
    deltaPositionX: Math.round(input.deltaClientX / outputScale),
    deltaPositionY: Math.round(input.deltaClientY / outputScale)
  };
}

/**
 * CUA & accessibility keyboard contract for 9:16 crop/framing viewport:
 * - Arrow keys: ±10px output offset (Shift + Arrow: ±50px)
 * - '+' / '=' / '-': ±0.05 scale (Shift: ±0.15)
 * - '0': Reset to Contain default (positionX: 0, positionY: 0, scale: 1)
 */
export function stepShortsTransformByKey(
  effects: ClipEffects,
  key: string,
  shiftKey: boolean,
  containScale = 1
): Partial<Pick<ClipEffects, 'positionX' | 'positionY' | 'scale'>> | null {
  const moveStep = shiftKey ? 50 : 10;
  const scaleStep = shiftKey ? 0.15 : 0.05;
  switch (key) {
    case 'ArrowLeft':
      return clampShortsTransform({ positionX: effects.positionX - moveStep });
    case 'ArrowRight':
      return clampShortsTransform({ positionX: effects.positionX + moveStep });
    case 'ArrowUp':
      return clampShortsTransform({ positionY: effects.positionY - moveStep });
    case 'ArrowDown':
      return clampShortsTransform({ positionY: effects.positionY + moveStep });
    case '+':
    case '=':
      return clampShortsTransform({ scale: effects.scale + scaleStep });
    case '-':
    case '_':
      return clampShortsTransform({ scale: effects.scale - scaleStep });
    case '0':
      return { positionX: 0, positionY: 0, scale: Math.round(containScale * 10000) / 10000 };
    default:
      return null;
  }
}

export function updateShortsTitle(
  timeline: TimelineDocument,
  titleId: string,
  changes: Partial<Omit<TimelineTitle, 'id'>>
): TimelineDocument | null {
  return updateTitle(timeline, titleId, changes);
}

export function addShortsTitle(
  timeline: TimelineDocument,
  input: { readonly id: string; readonly atMs: number; readonly text: string }
): TimelineDocument {
  return addTitle(timeline, input);
}

export function removeShortsTitle(timeline: TimelineDocument, titleId: string): TimelineDocument | null {
  return removeTitle(timeline, titleId);
}

export function applyPresetToShortsTitles(
  timeline: TimelineDocument,
  presetId: CaptionPresetId
): TimelineDocument {
  const titles = (timeline.titles ?? []).map((title) => applyCaptionPreset(title, presetId));
  return { ...timeline, titles };
}

export function findRecipeForCandidate(
  job: ShortsJob | null,
  candidateId: string | null
): ShortsRecipe | null {
  if (job?.recipes === undefined || candidateId === null) return null;
  return job.recipes.find((recipe) => recipe.candidate.id === candidateId) ?? null;
}

export function canApplyResultAsyncResponse(input: {
  readonly mounted: boolean;
  readonly currentRevision: number;
  readonly requestRevision: number;
}): boolean {
  return input.mounted && input.currentRevision === input.requestRevision;
}

export function formatShortsStageLabel(stage: ShortsJobStage, cleanupComplete: boolean): string {
  switch (stage) {
    case 'transcribing':
      return '음성 전사 중';
    case 'selecting':
      return 'AI 쇼츠 후보 선정 중';
    case 'review':
      return '후보 검토 대기';
    case 'creating':
      return '쇼츠 프로젝트 생성 중';
    case 'exporting':
      return '일괄 내보내기 중';
    case 'completed':
      return '완료';
    case 'partial':
      return '부분 완료';
    case 'failed':
      return '실패';
    case 'cancelling':
      return cleanupComplete ? '취소 정리 완료' : '취소 수락됨 · 정리 중';
    case 'cancelled':
      return cleanupComplete ? '취소됨 (정리 완료)' : '취소됨 (정리 대기 중)';
  }
}
