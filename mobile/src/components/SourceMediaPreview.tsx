import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { sourcePreviewDurationMs, sourceTransportTargetMs } from '@openvideo/shared/sourceMediaPreview';
import { buildSourcePreviewTracks, type SourceAudioStatus } from '@openvideo/shared/sourcePreviewTimeline';
import { TimelineRuler } from './TimelineRuler';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

const TRACK_LABELS = { video: 'Video', audio: 'Sound', subtitle: 'Subtitles' };
const EMPTY_LABELS = { 'no-duration': 'Loading duration', 'audio-unknown': 'Checking source audio', 'no-audio': 'No source audio', 'no-captions': 'No timed captions available' };

/** One custom transport and source clock, independent of the saved edit. */
export function SourceMediaPreview({ uri, name, durationMs }: { readonly uri: string; readonly name: string; readonly durationMs: number }) {
  const [decodedSeconds, setDecodedSeconds] = useState(0);
  const [audioStatus, setAudioStatus] = useState<SourceAudioStatus>('unknown');
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const player = useVideoPlayer(uri, instance => { instance.timeUpdateEventInterval = 0.1; });
  useEffect(() => {
    const subscriptions = [
      player.addListener('sourceLoad', event => {
        setDecodedSeconds(event.duration);
        setAudioStatus(event.availableAudioTracks.length > 0 ? 'present' : 'absent');
      }),
      player.addListener('timeUpdate', event => setPositionMs(Math.round(event.currentTime * 1000))),
      player.addListener('playingChange', event => setPlaying(event.isPlaying)),
      player.addListener('statusChange', event => setError(event.status === 'error' ? 'This source cannot be previewed on this device.' : null))
    ];
    return () => subscriptions.forEach(subscription => subscription.remove());
  }, [player]);
  const totalMs = sourcePreviewDurationMs(durationMs, decodedSeconds);
  const tracks = buildSourcePreviewTracks({ durationMs: totalMs, fileName: name, audioStatus, captions: [] });
  const disabled = totalMs <= 0 || error !== null;
  const seek = (nextMs: number): void => {
    if (disabled) return;
    const clamped = Math.max(0, Math.min(totalMs, nextMs));
    player.currentTime = clamped / 1000;
    setPositionMs(clamped);
  };
  const playheadPercent = totalMs > 0 ? Math.max(0, Math.min(100, positionMs / totalMs * 100)) : 0;
  return <View style={styles.root}>
    <Text style={styles.label}>Full source · {name}</Text>
    <VideoView style={styles.video} player={player} nativeControls={false} contentFit="contain" />
    <View style={styles.transport}>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => seek(sourceTransportTargetMs(positionMs, totalMs, 'start'))} style={press(styles.button)}><Text style={styles.label}>Start</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Back 5 seconds" disabled={disabled} onPress={() => seek(sourceTransportTargetMs(positionMs, totalMs, 'back'))} style={press(styles.button)}><Text style={styles.label}>−5s</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => {
        if (playing) player.pause(); else { if (positionMs >= totalMs) seek(0); player.play(); }
      }} style={press(styles.button)}><Text style={styles.label}>{playing ? 'Pause' : 'Play'}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Forward 5 seconds" disabled={disabled} onPress={() => seek(sourceTransportTargetMs(positionMs, totalMs, 'forward'))} style={press(styles.button)}><Text style={styles.label}>+5s</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => seek(sourceTransportTargetMs(positionMs, totalMs, 'end'))} style={press(styles.button)}><Text style={styles.label}>End</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ selected: muted }} onPress={() => { player.muted = !muted; setMuted(!muted); }} style={press(styles.button)}><Text style={styles.label}>{muted ? 'Unmute' : 'Mute'}</Text></Pressable>
      <Text style={styles.label}>{(positionMs / 1000).toFixed(1)} / {(totalMs / 1000).toFixed(1)}s</Text>
    </View>
    <View style={styles.row}>
      <Text style={styles.trackLabel}>Source</Text>
      <Pressable style={styles.clock} disabled={disabled} onLayout={event => setWidth(event.nativeEvent.layout.width)}
        accessibilityRole="adjustable" accessibilityLabel="Full source playback position"
        accessibilityValue={{ min: 0, max: totalMs, now: positionMs, text: `${(positionMs / 1000).toFixed(1)} seconds` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => seek(positionMs + (event.nativeEvent.actionName === 'increment' ? 1000 : -1000))}
        onPress={event => seek(width > 0 ? event.nativeEvent.locationX / width * totalMs : 0)}>
        {width > 0 && <TimelineRuler width={width} durationMs={totalMs} pxPerMs={width / Math.max(1, totalMs)} />}
      </Pressable>
    </View>
    {tracks.map(track => <View style={styles.row} key={track.kind}>
      <Text style={styles.trackLabel}>{TRACK_LABELS[track.kind]}</Text>
      <Pressable style={styles.lane} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${TRACK_LABELS[track.kind]} source timeline`}
        onPress={event => seek(width > 0 ? event.nativeEvent.locationX / width * totalMs : 0)}>
        <View pointerEvents="none" style={styles.laneContent}>
          {track.emptyReason !== null && <Text style={styles.empty} numberOfLines={1}>{EMPTY_LABELS[track.emptyReason]}</Text>}
          {track.segments.map(segment => <View key={segment.id} style={[styles.clip, track.kind === 'audio' && styles.soundClip,
            { left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }]}><Text style={styles.label} numberOfLines={1}>{segment.label}</Text></View>)}
          <View style={[styles.playhead, { left: `${playheadPercent}%` }]} />
        </View>
      </Pressable>
    </View>)}
    {error !== null && <Text accessibilityRole="alert" style={styles.label}>{error}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 8 }, label: { color: theme.textWeak, fontSize: 12 },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  transport: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  button: { minHeight: MIN_TAP, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: theme.line, borderRadius: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trackLabel: { color: theme.textWeak, width: 58, fontSize: 11 },
  clock: { flex: 1, minHeight: MIN_TAP, justifyContent: 'center' },
  lane: { flex: 1, minHeight: MIN_TAP, backgroundColor: theme.bg, overflow: 'hidden', borderWidth: 1, borderColor: theme.line },
  laneContent: { flex: 1, minHeight: MIN_TAP },
  clip: { position: 'absolute', top: 3, bottom: 3, paddingHorizontal: 8, justifyContent: 'center', backgroundColor: '#233541', borderWidth: 1, borderColor: '#507184' },
  soundClip: { backgroundColor: '#263a30', borderColor: '#547660' },
  empty: { color: theme.textWeaker, fontSize: 11, padding: 10 },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: theme.text }
});
