import type { ReactElement } from 'react';
import { sourceTransportTargetMs } from '../../../shared/sourceMediaPreview';
import { SourceTransportIcon } from './SourceTransportIcon';
import { formatDuration } from '../format';

export function PlaybackTransport({ positionMs, durationMs, playing, disabled, onSeek, onToggle, muted, onMute }: {
  readonly positionMs: number; readonly durationMs: number; readonly playing: boolean; readonly disabled: boolean;
  readonly onSeek: (ms: number) => void; readonly onToggle: () => void; readonly muted?: boolean; readonly onMute?: () => void;
}): ReactElement {
  return <div className="playback-transport" role="group" aria-label="영상 재생 제어">
    <output className="playback-transport__time" aria-label="현재 위치 및 전체 길이">{formatDuration(positionMs)} / {formatDuration(durationMs)}</output>
    {(['start', 'back', 'play', 'forward', 'end'] as const).map(action => {
      const label = action === 'start' ? '처음으로' : action === 'back' ? '5초 뒤로' : action === 'forward' ? '5초 앞으로' : action === 'end' ? '끝으로' : playing ? '일시정지' : '재생';
      return <button key={action} type="button" aria-label={label} title={label} disabled={disabled}
        onClick={() => action === 'play' ? onToggle() : onSeek(sourceTransportTargetMs(positionMs, durationMs, action))}>
        <SourceTransportIcon name={action === 'play' && playing ? 'pause' : action} />
      </button>;
    })}
    {onMute && <button type="button" aria-label={muted ? '소리 켜기' : '음소거'} title={muted ? '소리 켜기' : '음소거'} aria-pressed={muted} disabled={disabled} onClick={onMute}><SourceTransportIcon name={muted ? 'muted' : 'sound'} /></button>}
  </div>;
}
