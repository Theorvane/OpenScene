import type { SubtitleCue } from './narrationPlan';

export type SourceAudioStatus = 'present' | 'absent' | 'unknown';
export type SourceCaptionSnapshot = {
  readonly projectId: string;
  readonly assetId: string;
  readonly captions: readonly SubtitleCue[];
};
export type SourcePreviewSegment = {
  readonly id: string;
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly leftPercent: number;
  readonly widthPercent: number;
};
export type SourcePreviewTrack = {
  readonly kind: 'video' | 'audio' | 'subtitle';
  readonly segments: readonly SourcePreviewSegment[];
  readonly emptyReason: 'no-duration' | 'audio-unknown' | 'no-audio' | 'no-captions' | null;
};
const EMPTY_CAPTIONS: readonly SubtitleCue[] = [];

export function sourcePreviewCaptions(snapshot: SourceCaptionSnapshot | null | undefined, projectId: string, assetId: string): readonly SubtitleCue[] {
  return snapshot?.projectId === projectId && snapshot.assetId === assetId ? snapshot.captions : EMPTY_CAPTIONS;
}

/** Read-only lanes in original source time; no changes to the saved edit. */
export function buildSourcePreviewTracks(input: {
  readonly durationMs: number;
  readonly fileName: string;
  readonly audioStatus: SourceAudioStatus;
  readonly captions: readonly SubtitleCue[];
}): readonly SourcePreviewTrack[] {
  const durationMs = Number.isFinite(input.durationMs) ? Math.max(0, input.durationMs) : 0;
  const segment = (id: string, label: string, startMs: number, endMs: number): SourcePreviewSegment => ({
    id, label, startMs, endMs, leftPercent: startMs / durationMs * 100, widthPercent: (endMs - startMs) / durationMs * 100
  });
  const captions = input.captions.filter(cue => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs))
    .map(cue => ({ ...cue, startMs: Math.max(0, cue.startMs), endMs: Math.min(durationMs, cue.endMs) }))
    .filter(cue => cue.endMs > cue.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .map(cue => segment(cue.id, cue.text, cue.startMs, cue.endMs));
  return [
    { kind: 'video', segments: durationMs > 0 ? [segment('source-video', input.fileName, 0, durationMs)] : [], emptyReason: durationMs > 0 ? null : 'no-duration' },
    { kind: 'audio', segments: durationMs > 0 && input.audioStatus === 'present' ? [segment('source-audio', input.fileName, 0, durationMs)] : [],
      emptyReason: input.audioStatus === 'unknown' ? 'audio-unknown' : input.audioStatus === 'absent' ? 'no-audio' : durationMs <= 0 ? 'no-duration' : null },
    { kind: 'subtitle', segments: captions, emptyReason: captions.length === 0 ? 'no-captions' : null }
  ];
}
