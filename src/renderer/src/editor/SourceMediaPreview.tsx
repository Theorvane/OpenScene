import { useEffect, useRef, useState, type ReactElement } from 'react';
import { selectSourcePreviewAsset, sourcePreviewDurationMs } from '../../../shared/sourceMediaPreview';
import { formatDuration } from '../format';

type SourceAsset = {
  readonly id: string;
  readonly kind: string;
  readonly displayName: string;
  readonly metadata?: { readonly durationMs?: number } | null;
};
type Props = {
  readonly projectId: string;
  readonly assets: readonly SourceAsset[];
  readonly selectedAssetId: string | null;
  readonly active: boolean;
};

export function SourceMediaPreview(props: Props): ReactElement | null {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const asset = selectSourcePreviewAsset(props.assets, selectedId ?? props.selectedAssetId);
  if (asset === null) return null;
  return <div className="source-media-preview">
    <header className="source-media-preview__header">
      <h2>원본 영상</h2>
      <select aria-label="확인할 원본 영상" value={asset.id} onChange={event => setSelectedId(event.target.value)}>
        {props.assets.filter(item => item.kind === 'video').map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
      </select>
      <span>전체 길이 · 원본 확인</span>
    </header>
    <SourcePlayer key={`${props.projectId}:${asset.id}`} projectId={props.projectId} asset={asset} active={props.active} />
  </div>;
}

function SourcePlayer({ projectId, asset, active }: { readonly projectId: string; readonly asset: SourceAsset; readonly active: boolean }): ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [decodedDuration, setDecodedDuration] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const durationMs = sourcePreviewDurationMs(asset.metadata?.durationMs, decodedDuration);
  useEffect(() => {
    let live = true;
    setError(null);
    void window.videoTool.getAssetPlaybackUrl({ projectId, assetId: asset.id }).then(response => {
      if (!live) return;
      if (response.ok) setUrl(response.value.url);
      else setError(response.error.message);
    }).catch(() => { if (live) setError('원본 영상을 불러오지 못했습니다.'); });
    return () => { live = false; };
  }, [projectId, asset.id, retry]);
  useEffect(() => { if (!active && videoRef.current?.paused === false) videoRef.current.pause(); }, [active]);
  const seek = (value: number): void => {
    const video = videoRef.current;
    if (video === null || durationMs <= 0) return;
    try { video.currentTime = Math.max(0, Math.min(value, durationMs)) / 1000; setPositionMs(video.currentTime * 1000); }
    catch { setError('아직 이동할 수 없습니다. 영상 로딩 후 다시 시도하세요.'); }
  };
  return <>
    <video ref={videoRef} src={url ?? undefined} controls playsInline preload="metadata" aria-label={`원본 미리보기: ${asset.displayName}`}
      onLoadedMetadata={event => setDecodedDuration(event.currentTarget.duration)}
      onDurationChange={event => setDecodedDuration(event.currentTarget.duration)}
      onTimeUpdate={event => setPositionMs(Math.round(event.currentTarget.currentTime * 1000))}
      onError={() => setError('이 영상을 미리 볼 수 없습니다. 파일과 지원 코덱을 확인하세요.')} />
    {error !== null && <div role="alert">{error} <button type="button" onClick={() => { setRetry(value => value + 1); videoRef.current?.load(); }}>다시 시도</button></div>}
    {url === null && error === null && <p>원본 영상 불러오는 중…</p>}
    <div className="source-media-preview__timeline">
      <div className="source-media-preview__ruler" aria-hidden="true"><span>0:00</span><span>{formatDuration(durationMs / 2)}</span><span>{formatDuration(durationMs)}</span></div>
      <label>원본 전체 타임라인
        <input type="range" min={0} max={durationMs} step={1} value={Math.min(positionMs, durationMs)} disabled={url === null || durationMs <= 0 || error !== null}
          aria-label="원본 영상 재생 위치" aria-valuetext={`${formatDuration(positionMs)} / ${formatDuration(durationMs)}`}
          onChange={event => seek(Number(event.target.value))} />
      </label>
      <div className="source-media-preview__ruler"><span className="os-ui-truncate">{asset.displayName}</span><span>{formatDuration(positionMs)} / {formatDuration(durationMs)}</span></div>
    </div>
  </>;
}
