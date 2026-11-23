import type { ReactElement } from 'react';

import { CAPTION_STYLE_PRESETS, type CaptionPresetId } from '../../../../shared/captionStyle';
import type { SubtitleCue } from '../../../../shared/narrationPlan';
import type { ShortsCandidate } from '../../../../shared/shortsCandidateSelection';
import {
  CLIP_EFFECT_RANGES,
  DEFAULT_CLIP_EFFECTS,
  type ClipEffects,
  type LocalProjectSnapshot,
  type TimelineDocument
} from '../../../../shared/timelineTypes';
import { formatDuration } from '../../format';
import { Button, StatusCard } from '../../ui';
import { TimingInput } from '../InspectorControls';
import {
  SHORTS_FIT_LABEL,
  addShortsTitle,
  applyPresetToShortsTitles,
  computeContainScale,
  computeManualFillScale,
  filterSourceCaptionsForCandidate,
  getPrimaryShortsClip,
  removeShortsTitle,
  stepShortsClipRange,
  updateShortsClipSourceRange,
  updateShortsClipTransform,
  updateShortsTitle
} from './shortsReviewState';

type ShortsResultEditorProps = {
  readonly candidate: ShortsCandidate | null;
  readonly sourceCaptions: readonly SubtitleCue[] | undefined;
  readonly resultProjectId: string | undefined;
  readonly resultProject: LocalProjectSnapshot | null;
  readonly isLoadingResult: boolean;
  readonly isSavingResult: boolean;
  readonly isDirty: boolean;
  readonly statusMessage: string | null;
  readonly onChangeTimeline: (updater: (timeline: TimelineDocument) => TimelineDocument | null) => void;
  readonly onSaveTimeline: () => void;
  readonly onOpenInTimelineEditor: () => void;
};

export function ShortsResultEditor({
  candidate,
  sourceCaptions,
  resultProjectId,
  resultProject,
  isLoadingResult,
  isSavingResult,
  isDirty,
  statusMessage,
  onChangeTimeline,
  onSaveTimeline,
  onOpenInTimelineEditor
}: ShortsResultEditorProps): ReactElement {
  if (candidate === null) {
    return (
      <div className="shorts-section">
        <p className="shorts-muted">좌측에서 쇼츠 후보 카드를 선택하면 상세 정보와 편집 도구가 표시됩니다.</p>
      </div>
    );
  }

  const previewCaptions = filterSourceCaptionsForCandidate(sourceCaptions, candidate);

  if (resultProjectId === undefined) {
    return (
      <>
        <section className="shorts-section" aria-label="후보 검토 요약">
          <h3 className="shorts-section__title">선정 근거 및 구간</h3>
          <p className="shorts-candidate-card__reason">{candidate.reason}</p>
          {candidate.context.notes.trim().length > 0 && (
            <p className="shorts-muted">문맥 메모: {candidate.context.notes}</p>
          )}
          <div className="shorts-row">
            <span>원본 구간</span>
            <strong>{formatDuration(candidate.startMs)} – {formatDuration(candidate.endMs)}</strong>
          </div>
          <div className="shorts-row">
            <span>기본 프레임</span>
            <span>{SHORTS_FIT_LABEL}</span>
          </div>
          <p className="shorts-muted">
            시작·끝 트림, 수동 9:16 배치 조정, 자막 텍스트 수정은 좌측에서 후보를 선택해
            <strong> 쇼츠 프로젝트 생성</strong> 후 격리된 결과 프로젝트에서 안전하게 편집합니다(원본 프로젝트 비수정).
          </p>
        </section>

        <section className="shorts-section" aria-label="원본 자막 프리뷰" data-testid="shorts-preview-caption-list">
          <h3 className="shorts-section__title">원본 자막 프리뷰 ({previewCaptions.length}건 · source ms)</h3>
          {previewCaptions.length === 0 ? (
            <p className="shorts-muted">이 구간에 매칭된 원본 전사 자막이 없습니다.</p>
          ) : (
            <div className="shorts-subtitle-list">
              {previewCaptions.map(({ cue, relativeStartMs, relativeEndMs }) => (
                <div key={cue.id} className="shorts-subtitle-item" data-testid={`shorts-preview-caption-${cue.id}`}>
                  <div className="shorts-subtitle-item__times">
                    <span>원본 {formatDuration(cue.startMs)}–{formatDuration(cue.endMs)}</span>
                    <span>(클립 +{formatDuration(relativeStartMs)}–{formatDuration(relativeEndMs)})</span>
                  </div>
                  <span>{cue.text}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </>
    );
  }

  if (isLoadingResult || resultProject === null) {
    return (
      <div className="shorts-section">
        <p className="shorts-muted">격리 쇼츠 프로젝트({resultProjectId})를 불러오는 중…</p>
      </div>
    );
  }

  const clip = getPrimaryShortsClip(resultProject.timeline);
  const videoAsset =
    clip === null
      ? null
      : resultProject.assets.find((asset) => asset.id === clip.assetId) ?? resultProject.assets[0] ?? null;
  const effects: ClipEffects = clip?.effects ?? DEFAULT_CLIP_EFFECTS;
  const titles = resultProject.timeline.titles ?? [];

  const applyRange = (sourceStartMs: number, sourceEndMs: number): void => {
    if (clip === null) return;
    onChangeTimeline((current) =>
      updateShortsClipSourceRange(current, {
        clipId: clip.id,
        sourceStartMs,
        sourceEndMs
      })
    );
  };

  const applyTransform = (partial: Partial<Pick<ClipEffects, 'positionX' | 'positionY' | 'scale'>>): void => {
    if (clip === null) return;
    onChangeTimeline((current) => updateShortsClipTransform(current, clip.id, partial));
  };

  return (
    <>
      <section className="shorts-section" aria-label="격리 프로젝트 저장 및 편집기 이동">
        <div className="shorts-row">
          <h3 className="shorts-section__title">격리 쇼츠 프로젝트 편집</h3>
          <span className="shorts-badge">{isDirty ? '미저장 변경 있음' : '저장됨'}</span>
        </div>
        <div className="shorts-nudge-group">
          <Button
            variant="primary"
            data-testid="shorts-save-result-btn"
            data-dirty={isDirty ? 'true' : 'false'}
            data-saving={isSavingResult ? 'true' : 'false'}
            aria-busy={isSavingResult}
            disabled={!isDirty || isSavingResult}
            onClick={onSaveTimeline}
          >
            {isSavingResult ? '저장 중…' : '변경사항 저장'}
          </Button>
          <Button
            data-testid={`shorts-open-in-editor-btn-${candidate.id}`}
            disabled={isSavingResult}
            onClick={onOpenInTimelineEditor}
          >
            편집기에서 열기
          </Button>
        </div>
        {statusMessage !== null && <StatusCard tone="neutral">{statusMessage}</StatusCard>}
      </section>

      {clip !== null && (
        <section className="shorts-section" aria-label="시작·끝 시간 트림">
          <h3 className="shorts-section__title">시작 · 끝 미세 조정 (원본 초)</h3>
          <div className="shorts-row">
            <label htmlFor="shorts-trim-start">시작 (s)</label>
            <div data-testid="shorts-trim-start-input">
              <TimingInput
                label="Short clip source start in seconds"
                valueMs={clip.sourceStartMs}
                onCommit={(ms) => applyRange(ms, clip.sourceEndMs)}
              />
            </div>
          </div>
          <div className="shorts-nudge-group" role="group" aria-label="시작 시간 미세 이동">
            <button
              type="button"
              data-testid="shorts-trim-start-minus-1s"
              onClick={() => {
                const next = stepShortsClipRange(clip, 'start', -1000);
                applyRange(next.sourceStartMs, next.sourceEndMs);
              }}
            >
              -1s
            </button>
            <button
              type="button"
              data-testid="shorts-trim-start-minus"
              onClick={() => {
                const next = stepShortsClipRange(clip, 'start', -100);
                applyRange(next.sourceStartMs, next.sourceEndMs);
              }}
            >
              -0.1s
            </button>
            <button
              type="button"
              data-testid="shorts-trim-start-plus"
              onClick={() => {
                const next = stepShortsClipRange(clip, 'start', 100);
                applyRange(next.sourceStartMs, next.sourceEndMs);
              }}
            >
              +0.1s
            </button>
            <button
              type="button"
              data-testid="shorts-trim-start-plus-1s"
              onClick={() => {
                const next = stepShortsClipRange(clip, 'start', 1000);
                applyRange(next.sourceStartMs, next.sourceEndMs);
              }}
            >
              +1s
            </button>
          </div>

          <div className="shorts-row">
            <label htmlFor="shorts-trim-end">끝 (s)</label>
            <div data-testid="shorts-trim-end-input">
              <TimingInput
                label="Short clip source end in seconds"
                valueMs={clip.sourceEndMs}
                onCommit={(ms) => applyRange(clip.sourceStartMs, ms)}
              />
            </div>
          </div>
          <div className="shorts-nudge-group" role="group" aria-label="끝 시간 미세 이동">
            <button
              type="button"
              data-testid="shorts-trim-end-minus-1s"
              onClick={() => {
                const next = stepShortsClipRange(clip, 'end', -1000);
                applyRange(next.sourceStartMs, next.sourceEndMs);
              }}
            >
              -1s
            </button>
            <button
              type="button"
              data-testid="shorts-trim-end-minus"
              onClick={() => {
                const next = stepShortsClipRange(clip, 'end', -100);
                applyRange(next.sourceStartMs, next.sourceEndMs);
              }}
            >
              -0.1s
            </button>
            <button
              type="button"
              data-testid="shorts-trim-end-plus"
              onClick={() => {
                const next = stepShortsClipRange(clip, 'end', 100);
                applyRange(next.sourceStartMs, next.sourceEndMs);
              }}
            >
              +0.1s
            </button>
            <button
              type="button"
              data-testid="shorts-trim-end-plus-1s"
              onClick={() => {
                const next = stepShortsClipRange(clip, 'end', 1000);
                applyRange(next.sourceStartMs, next.sourceEndMs);
              }}
            >
              +1s
            </button>
          </div>
          <p className="shorts-muted">
            클립 길이: {formatDuration(clip.sourceEndMs - clip.sourceStartMs)} (원본 최대 {formatDuration(clip.sourceDurationMs)})
          </p>
        </section>
      )}

      {clip !== null && (
        <section className="shorts-section" aria-label="수동 9:16 크롭 및 프레임 배치">
          <h3 className="shorts-section__title">수동 9:16 크롭 / 배치 (얼굴추적 미포함)</h3>
          <p className="shorts-muted">
            기본 출력은 {SHORTS_FIT_LABEL} (배율 <code>min(1080/w, 1920/h, 2)</code> · 최대 2x 상한, 소형 원본은 여백 유지)이며, 기존 편집기 Transform(위치·확대) 범위에서 수동 조정할 수 있습니다.
          </p>
          <div className="shorts-row">
            <label htmlFor="shorts-crop-x">위치 X (px)</label>
            <input
              id="shorts-crop-x"
              type="number"
              data-testid="shorts-crop-offset-x-input"
              aria-label="9:16 crop horizontal offset X"
              min={CLIP_EFFECT_RANGES.positionX.min}
              max={CLIP_EFFECT_RANGES.positionX.max}
              step={10}
              value={effects.positionX}
              onChange={(event) => applyTransform({ positionX: Number(event.currentTarget.value) })}
            />
          </div>
          <div className="shorts-row">
            <label htmlFor="shorts-crop-y">위치 Y (px)</label>
            <input
              id="shorts-crop-y"
              type="number"
              data-testid="shorts-crop-offset-y-input"
              aria-label="9:16 crop vertical offset Y"
              min={CLIP_EFFECT_RANGES.positionY.min}
              max={CLIP_EFFECT_RANGES.positionY.max}
              step={10}
              value={effects.positionY}
              onChange={(event) => applyTransform({ positionY: Number(event.currentTarget.value) })}
            />
          </div>
          <div className="shorts-row">
            <label htmlFor="shorts-crop-scale">확대 ({Math.round(effects.scale * 100)}%)</label>
            <input
              id="shorts-crop-scale"
              type="range"
              data-testid="shorts-crop-scale-input"
              aria-label="9:16 crop manual scale"
              min={10}
              max={CLIP_EFFECT_RANGES.scale.max * 100}
              step={1}
              value={Math.round(effects.scale * 100)}
              onChange={(event) => applyTransform({ scale: Number(event.currentTarget.value) / 100 })}
            />
          </div>
          <div className="shorts-nudge-group">
            <button
              type="button"
              data-testid="shorts-crop-reset-btn"
              onClick={() =>
                applyTransform({
                  positionX: 0,
                  positionY: 0,
                  scale: computeContainScale(videoAsset?.metadata?.width, videoAsset?.metadata?.height)
                })
              }
            >
              Contain 기본값 리셋
            </button>
            <button
              type="button"
              data-testid="shorts-crop-fill-btn"
              onClick={() =>
                applyTransform({
                  positionX: 0,
                  positionY: 0,
                  scale: computeManualFillScale(videoAsset?.metadata?.width, videoAsset?.metadata?.height)
                })
              }
            >
              수동 확대 채우기
            </button>
          </div>
        </section>
      )}

      <section className="shorts-section" aria-label="자막 검토 및 수정" data-testid="shorts-subtitle-list">
        <div className="shorts-row">
          <h3 className="shorts-section__title">자막 검토 · 수정 ({titles.length}건)</h3>
          <button
            type="button"
            data-testid="shorts-subtitle-add-btn"
            onClick={() => {
              onChangeTimeline((current) => {
                const currentTitles = current.titles ?? [];
                const lastEnd = currentTitles.reduce((max, item) => Math.max(max, item.timelineEndMs), 0);
                return addShortsTitle(current, {
                  id: `shorts-caption-${Date.now()}-${currentTitles.length + 1}`,
                  atMs: lastEnd,
                  text: '새 자막'
                });
              });
            }}
          >
            + 자막 추가
          </button>
        </div>
        {titles.length > 0 && (
          <div className="shorts-row">
            <label htmlFor="shorts-subtitle-preset">자막 스타일 일괄</label>
            <select
              id="shorts-subtitle-preset"
              data-testid="shorts-subtitle-preset-select"
              aria-label="Apply caption preset to all short captions"
              defaultValue=""
              onChange={(event) => {
                const presetId = event.currentTarget.value as CaptionPresetId | '';
                if (presetId === '') return;
                onChangeTimeline((current) => applyPresetToShortsTitles(current, presetId));
              }}
            >
              <option value="" disabled>프리셋 선택…</option>
              {CAPTION_STYLE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
            </select>
          </div>
        )}
        {titles.length === 0 ? (
          <p className="shorts-muted">등록된 자막이 없습니다. "+ 자막 추가"로 자막을 넣을 수 있습니다.</p>
        ) : (
          <div className="shorts-subtitle-list">
            {titles.map((title) => (
              <div key={title.id} className="shorts-subtitle-item" data-testid={`shorts-subtitle-cue-${title.id}`}>
                <div className="shorts-subtitle-item__times">
                  <span data-testid={`shorts-subtitle-start-${title.id}`}>
                    <TimingInput
                      label={`Caption ${title.id} start in seconds`}
                      valueMs={title.timelineStartMs}
                      onCommit={(ms) => {
                        onChangeTimeline((current) => updateShortsTitle(current, title.id, { timelineStartMs: ms }));
                      }}
                    />
                  </span>
                  <span>–</span>
                  <span data-testid={`shorts-subtitle-end-${title.id}`}>
                    <TimingInput
                      label={`Caption ${title.id} end in seconds`}
                      valueMs={title.timelineEndMs}
                      onCommit={(ms) => {
                        onChangeTimeline((current) => updateShortsTitle(current, title.id, { timelineEndMs: ms }));
                      }}
                    />
                  </span>
                  <button
                    type="button"
                    aria-label={`Delete caption ${title.id}`}
                    data-testid={`shorts-subtitle-delete-${title.id}`}
                    onClick={() => {
                      onChangeTimeline((current) => removeShortsTitle(current, title.id));
                    }}
                  >
                    삭제
                  </button>
                </div>
                <textarea
                  aria-label={`Caption text ${title.id}`}
                  data-testid={`shorts-subtitle-text-${title.id}`}
                  value={title.text}
                  onChange={(event) => {
                    const nextText = event.currentTarget.value;
                    onChangeTimeline((current) => updateShortsTitle(current, title.id, { text: nextText }));
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
