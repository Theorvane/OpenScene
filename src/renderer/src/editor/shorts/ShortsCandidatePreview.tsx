import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement
} from 'react';

import { resolvedTitleStyle } from '../../../../shared/captionStyle';
import type { SubtitleCue } from '../../../../shared/narrationPlan';
import type { ShortsCandidate } from '../../../../shared/shortsCandidateSelection';
import type { ShortsRecipe } from '../../../../shared/shortsTypes';
import { titlePreviewLayout, titlesAt } from '../../../../shared/titlePreviewLayout';
import { titleFontCssFamily, titleShadowColor } from '../../../../shared/titleTypography';
import {
  DEFAULT_CLIP_EFFECTS,
  type ClipEffects,
  type LocalProjectSnapshot,
  type MediaAsset
} from '../../../../shared/timelineTypes';
import { formatDuration } from '../../format';
import { Button } from '../../ui';
import { useAssetPlaybackUrl } from '../TimelineCanvas';
import { useTitleFontFaces } from '../useTitleFontFaces';
import {
  SHORTS_FIT_LABEL,
  SHORTS_MANUAL_TRANSFORM_LABEL,
  SHORTS_OUTPUT_HEIGHT,
  SHORTS_OUTPUT_WIDTH,
  activeSourceCaptionsAt,
  computeContainScale,
  computeShortsPreviewMediaStyle,
  getPrimaryShortsClip,
  isManualTransformModified,
  pointerDeltaToOutputOffset,
  stepShortsTransformByKey
} from './shortsReviewState';

type ShortsCandidatePreviewProps = {
  readonly sourceProjectId: string;
  readonly sourceAsset: MediaAsset | null;
  readonly candidate: ShortsCandidate | null;
  readonly sourceCaptions: readonly SubtitleCue[] | undefined;
  readonly recipe: ShortsRecipe | null;
  readonly resultProject: LocalProjectSnapshot | null;
  readonly onUpdateTransform?: ((partial: Partial<Pick<ClipEffects, 'positionX' | 'positionY' | 'scale'>>) => void) | undefined;
};

const REFERENCE_FRAME = { width: SHORTS_OUTPUT_WIDTH, height: SHORTS_OUTPUT_HEIGHT } as const;

export function ShortsCandidatePreview({
  sourceProjectId,
  sourceAsset,
  candidate,
  sourceCaptions,
  recipe,
  resultProject,
  onUpdateTransform
}: ShortsCandidatePreviewProps): ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragOriginRef = useRef<{
    readonly pointerId: number;
    readonly startClientX: number;
    readonly startClientY: number;
    readonly initialX: number;
    readonly initialY: number;
  } | null>(null);

  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const resultClip = resultProject === null ? null : getPrimaryShortsClip(resultProject.timeline);
  const resultAsset =
    resultProject === null || resultClip === null
      ? null
      : resultProject.assets.find((asset) => asset.id === resultClip.assetId) ?? resultProject.assets[0] ?? null;

  const activeProjectId = resultProject !== null && resultAsset !== null ? resultProject.id : sourceProjectId;
  const activeAsset = resultProject !== null && resultAsset !== null ? resultAsset : sourceAsset;
  const playbackUrl = useAssetPlaybackUrl(activeProjectId, activeAsset?.id ?? '');

  const rangeStartMs = resultClip?.sourceStartMs ?? candidate?.startMs ?? 0;
  const rangeEndMs = resultClip?.sourceEndMs ?? candidate?.endMs ?? activeAsset?.metadata?.durationMs ?? 0;
  const rangeDurationMs = Math.max(0, rangeEndMs - rangeStartMs);
  const [relativeTimeMs, setRelativeTimeMs] = useState(0);

  useEffect(() => {
    setRelativeTimeMs(0);
    setIsPlaying(false);
    const video = videoRef.current;
    if (video !== null) {
      video.pause();
      if (Number.isFinite(rangeStartMs)) {
        try {
          video.currentTime = rangeStartMs / 1000;
        } catch {
          // Video may not have loaded metadata yet; onLoadedMetadata handles initial seek.
        }
      }
    }
  }, [activeAsset?.id, candidate?.id, rangeStartMs, resultProject?.id]);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box !== undefined) setViewportSize({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const sourceWidth = recipe?.sourceDimensions.width ?? activeAsset?.metadata?.width;
  const sourceHeight = recipe?.sourceDimensions.height ?? activeAsset?.metadata?.height;
  const containScale = computeContainScale(sourceWidth, sourceHeight);
  const effects = resultClip?.effects ?? { ...DEFAULT_CLIP_EFFECTS, scale: containScale };
  const canEditTransform = resultProject !== null && resultClip !== null && onUpdateTransform !== undefined;
  const isModifiedTransform = isManualTransformModified(effects, sourceWidth, sourceHeight);

  const mediaStyle = useMemo(() => {
    const computed = computeShortsPreviewMediaStyle({
      effects,
      viewportWidthPx: viewportSize.width,
      viewportHeightPx: viewportSize.height,
      sourceWidth,
      sourceHeight
    });
    if (computed.widthPx <= 0 || computed.heightPx <= 0) {
      return { width: '100%', height: 'auto' };
    }
    return {
      width: `${computed.widthPx}px`,
      height: `${computed.heightPx}px`,
      transform: `translate(${computed.translateXPx}px, ${computed.translateYPx}px)`
    };
  }, [effects, sourceHeight, sourceWidth, viewportSize.height, viewportSize.width]);

  const currentSourceMs = rangeStartMs + relativeTimeMs;
  const activeTitles = useMemo(
    () => (resultProject === null ? [] : titlesAt(resultProject.timeline.titles, relativeTimeMs)),
    [relativeTimeMs, resultProject]
  );
  const activePreviewCues = useMemo(
    () => (resultProject !== null ? [] : activeSourceCaptionsAt(sourceCaptions, currentSourceMs)),
    [currentSourceMs, resultProject, sourceCaptions]
  );
  const titleFonts = useTitleFontFaces(activeTitles);

  const seekToRelativeMs = (nextMs: number): void => {
    const clamped = Math.max(0, Math.min(rangeDurationMs, Math.round(nextMs)));
    setRelativeTimeMs(clamped);
    const video = videoRef.current;
    if (video !== null) {
      try {
        video.currentTime = (rangeStartMs + clamped) / 1000;
      } catch {
        // Ignore seek errors while media is still loading.
      }
    }
  };

  const togglePlayback = (): void => {
    const video = videoRef.current;
    if (video === null || playbackUrl === null || rangeDurationMs <= 0) return;
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      return;
    }
    if (relativeTimeMs >= rangeDurationMs - 40) {
      seekToRelativeMs(0);
    }
    void video.play().then(
      () => setIsPlaying(true),
      () => setIsPlaying(false)
    );
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!canEditTransform || event.button !== 0) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOriginRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      initialX: effects.positionX,
      initialY: effects.positionY
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const origin = dragOriginRef.current;
    if (origin === null || origin.pointerId !== event.pointerId || !canEditTransform) return;
    const { deltaPositionX, deltaPositionY } = pointerDeltaToOutputOffset({
      deltaClientX: event.clientX - origin.startClientX,
      deltaClientY: event.clientY - origin.startClientY,
      viewportWidthPx: viewportSize.width,
      viewportHeightPx: viewportSize.height
    });
    onUpdateTransform({
      positionX: origin.initialX + deltaPositionX,
      positionY: origin.initialY + deltaPositionY
    });
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const origin = dragOriginRef.current;
    if (origin === null || origin.pointerId !== event.pointerId) return;
    dragOriginRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleViewportKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === ' ') {
      event.preventDefault();
      togglePlayback();
      return;
    }
    if (event.key === 'Escape') {
      if (dragOriginRef.current !== null && canEditTransform) {
        onUpdateTransform({
          positionX: dragOriginRef.current.initialX,
          positionY: dragOriginRef.current.initialY
        });
        dragOriginRef.current = null;
        setIsDragging(false);
      }
      event.currentTarget.blur();
      return;
    }
    if (!canEditTransform) return;
    const next = stepShortsTransformByKey(effects, event.key, event.shiftKey, containScale);
    if (next !== null) {
      event.preventDefault();
      onUpdateTransform(next);
    }
  };

  return (
    <section
      className="shorts-preview-stage"
      data-testid="shorts-preview-stage"
      aria-label="9:16 쇼츠 프리뷰"
    >
      <div className="shorts-preview-header">
        <span className="shorts-badge shorts-badge--fit" data-testid="shorts-preview-fit-badge">
          {isModifiedTransform ? SHORTS_MANUAL_TRANSFORM_LABEL : SHORTS_FIT_LABEL}
        </span>
        <span className="shorts-muted">
          출력 {SHORTS_OUTPUT_WIDTH}×{SHORTS_OUTPUT_HEIGHT} · 30fps
          {canEditTransform
            ? ' · 드래그 또는 화살표/Shift+화살표/+/-/0으로 수동 배치'
            : ' · 프로젝트 생성 후 수동 배치·트림·자막 수정 가능'}
        </span>
      </div>

      <div
        ref={viewportRef}
        className="shorts-crop-viewport"
        data-testid="shorts-crop-viewport"
        data-draggable={canEditTransform ? 'true' : 'false'}
        data-dragging={isDragging ? 'true' : 'false'}
        role="application"
        tabIndex={0}
        aria-label="9:16 manual crop and framing preview"
        aria-roledescription={canEditTransform ? 'Draggable and keyboard-adjustable 9:16 framing viewport' : 'Read-only 9:16 Contain preview'}
        aria-valuetext={`Offset X ${effects.positionX}px, Offset Y ${effects.positionY}px, Scale ${Math.round(effects.scale * 100)}%`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={handleViewportKeyDown}
      >
        {candidate === null && resultProject === null ? (
          <p className="shorts-muted" style={{ padding: 16, textAlign: 'center', color: '#cbd5e1' }}>
            후보 카드를 선택하면 9:16 캔버스(Contain · 얼굴추적 미포함) 미리보기가 표시됩니다.
          </p>
        ) : playbackUrl === null ? (
          <p className="shorts-muted" style={{ padding: 16, textAlign: 'center', color: '#cbd5e1' }}>
            로컬 영상 프리뷰를 불러오는 중…
          </p>
        ) : (
          <video
            ref={videoRef}
            className="shorts-crop-viewport__video"
            src={playbackUrl}
            playsInline
            preload="metadata"
            style={mediaStyle}
            onLoadedMetadata={(event) => {
              event.currentTarget.currentTime = rangeStartMs / 1000;
            }}
            onTimeUpdate={(event) => {
              const currentMs = Math.round(event.currentTarget.currentTime * 1000);
              if (rangeEndMs > rangeStartMs && currentMs >= rangeEndMs) {
                event.currentTarget.pause();
                event.currentTarget.currentTime = rangeStartMs / 1000;
                setIsPlaying(false);
                setRelativeTimeMs(0);
                return;
              }
              setRelativeTimeMs(Math.max(0, currentMs - rangeStartMs));
            }}
            onEnded={() => setIsPlaying(false)}
          />
        )}

        <div className="shorts-crop-viewport__guide" aria-hidden="true" />

        <div
          className="shorts-crop-viewport__captions"
          data-testid="shorts-preview-captions-overlay"
          aria-live="off"
        >
          {resultProject !== null && titleFonts.ready && activeTitles.map((title) => {
            const layout = titlePreviewLayout(title, viewportSize, REFERENCE_FRAME);
            const style = resolvedTitleStyle(title);
            const background =
              style.backgroundOpacity <= 0
                ? 'transparent'
                : `${style.backgroundColor}${Math.round(style.backgroundOpacity * 255).toString(16).padStart(2, '0')}`;
            return (
              <span
                key={title.id}
                className="shorts-crop-viewport__caption-item"
                style={{
                  color: title.color,
                  fontSize: `${Math.max(11, layout.fontSizePx)}px`,
                  fontWeight: style.fontWeight === 'bold' ? 700 : 400,
                  fontFamily: `"${titleFontCssFamily(style.fontFamily ?? 'sans')}"`,
                  textShadow:
                    style.shadow && style.shadow.opacity > 0
                      ? `${(style.shadow.offsetX * layout.fontSizePx) / title.sizePx}px ${(style.shadow.offsetY * layout.fontSizePx) / title.sizePx}px 0 ${titleShadowColor(style.shadow)}`
                      : undefined,
                  backgroundColor: background,
                  padding: `${layout.paddingPx}px`,
                  WebkitTextStroke:
                    layout.outlineWidthPx > 0 ? `${layout.outlineWidthPx}px ${style.outlineColor}` : undefined,
                  paintOrder: 'stroke fill',
                  transform: `translate(${layout.offsetXPx}px, ${layout.offsetYPx}px)`
                }}
              >
                {title.text}
              </span>
            );
          })}

          {resultProject === null && activePreviewCues.map((cue) => (
            <span
              key={cue.id}
              className="shorts-crop-viewport__caption-item"
              style={{
                color: '#ffffff',
                backgroundColor: 'rgba(0, 0, 0, 0.72)',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: 600,
                marginTop: 'auto',
                marginBottom: '12%'
              }}
            >
              {cue.text}
            </span>
          ))}
        </div>
      </div>

      <div className="shorts-preview-transport">
        <Button
          data-testid="shorts-preview-play-btn"
          disabled={playbackUrl === null || rangeDurationMs <= 0}
          aria-label={isPlaying ? 'Pause short preview' : 'Play short preview'}
          onClick={togglePlayback}
        >
          {isPlaying ? '일시정지' : '재생'}
        </Button>
        <input
          type="range"
          data-testid="shorts-preview-scrub-slider"
          aria-label="Short preview timeline position"
          min={0}
          max={Math.max(1, rangeDurationMs)}
          step={50}
          value={Math.min(relativeTimeMs, Math.max(0, rangeDurationMs))}
          disabled={playbackUrl === null || rangeDurationMs <= 0}
          onChange={(event) => seekToRelativeMs(Number(event.currentTarget.value))}
        />
        <span className="shorts-preview-transport__time">
          {formatDuration(relativeTimeMs)} / {formatDuration(rangeDurationMs)}
        </span>
      </div>

      {recipe !== null && (
        <details className="shorts-recipe-details" data-testid="shorts-recipe-meta">
          <summary>편집 레시피 메타 (v{recipe.version} · 향후 레시피 확장 보존)</summary>
          <div className="shorts-recipe-details__grid">
            <span>원본: {recipe.sourceDimensions.width}×{recipe.sourceDimensions.height} · {formatDuration(recipe.sourceDurationMs)}</span>
            <span>출력: {recipe.output.width}×{recipe.output.height} @{recipe.output.frameRate}fps ({recipe.output.fit}, 최대 2x)</span>
            <span>원본 구간: {formatDuration(recipe.candidate.startMs)}–{formatDuration(recipe.candidate.endMs)}</span>
            <span>원본 해시: {recipe.sourceSha256.slice(0, 12)}… · 근거 자막 {recipe.evidenceSnapshot.length}건</span>
          </div>
        </details>
      )}
    </section>
  );
}
