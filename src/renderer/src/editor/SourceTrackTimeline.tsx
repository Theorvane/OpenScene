import type { MouseEvent, ReactElement } from 'react';
import type { SourcePreviewTrack } from '../../../shared/sourcePreviewTimeline';
import { formatDuration } from '../format';

const LABELS = { video: '영상', audio: '사운드', subtitle: '자막' } as const;
const EMPTY_LABELS = {
  'no-duration': '영상 길이 확인 중',
  'audio-unknown': '원본 내 오디오 정보 확인 전',
  'no-audio': '원본에 오디오 없음',
  'no-captions': '자막 없음 · 분석된 자막이 있으면 구간별로 표시됩니다'
} as const;

export function SourceTrackTimeline({ tracks, durationMs, positionMs, disabled, onSeek }: {
  readonly tracks: readonly SourcePreviewTrack[];
  readonly durationMs: number;
  readonly positionMs: number;
  readonly disabled: boolean;
  readonly onSeek: (positionMs: number) => void;
}): ReactElement {
  const position = Math.min(Math.max(0, positionMs), durationMs);
  const seekClip = (event: MouseEvent<HTMLButtonElement>, startMs: number, endMs: number): void => {
    // A keyboard activation jumps to the segment start; pointer clicks keep
    // their exact location on the same source clock as the seek slider.
    if (event.detail === 0) { onSeek(startMs); return; }
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.width > 0 ? Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) : 0;
    onSeek(startMs + ratio * (endMs - startMs));
  };
  return <div className="source-track-timeline" aria-label="원본 전체 타임라인">
    <div className="source-track-timeline__row">
      <span className="source-track-timeline__label">전체 길이</span>
      <div className="source-track-timeline__clock">
        <div className="source-media-preview__ruler" aria-hidden="true"><span>00:00</span><span>{formatDuration(durationMs / 2)}</span><span>{formatDuration(durationMs)}</span></div>
        <input type="range" min={0} max={durationMs} step={1} value={position} disabled={disabled}
          aria-label="원본 영상 재생 위치" aria-valuetext={`${formatDuration(position)} / ${formatDuration(durationMs)}`}
          onChange={event => onSeek(Number(event.target.value))} />
      </div>
    </div>
    <div className="source-track-timeline__lanes">
      {tracks.map(track => <div className="source-track-timeline__row" data-source-track={track.kind} key={track.kind}>
        <span className="source-track-timeline__label">{LABELS[track.kind]}</span>
        <div className="source-track-timeline__lane">
          {track.emptyReason !== null && <span className="source-track-timeline__empty">{EMPTY_LABELS[track.emptyReason]}</span>}
          {track.segments.map(segment => <button type="button" key={segment.id} className="source-track-timeline__clip"
            style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }} disabled={disabled}
            aria-label={`${LABELS[track.kind]}: ${segment.label}, ${formatDuration(segment.startMs)} – ${formatDuration(segment.endMs)}`}
            title={`${segment.label} · ${formatDuration(segment.startMs)} – ${formatDuration(segment.endMs)}`}
            onClick={event => seekClip(event, segment.startMs, segment.endMs)}>{segment.label}</button>)}
          <span className="source-track-timeline__playhead" aria-hidden="true" style={{ left: `${durationMs > 0 ? position / durationMs * 100 : 0}%` }} />
        </div>
      </div>)}
    </div>
  </div>;
}
