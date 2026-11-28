import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { sourcePreviewDurationMs } from '@openvideo/shared/sourceMediaPreview';
import { theme } from '../lib/theme';

/** Native controls seek across the original file, without inserting a clip. */
export function SourceMediaPreview({ uri, name, durationMs }: { readonly uri: string; readonly name: string; readonly durationMs: number }) {
  const [decodedSeconds, setDecodedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const player = useVideoPlayer(uri);
  useEffect(() => {
    const source = player.addListener('sourceLoad', event => setDecodedSeconds(event.duration));
    const status = player.addListener('statusChange', event => setError(event.status === 'error' ? 'This source cannot be previewed on this device.' : null));
    return () => { source.remove(); status.remove(); };
  }, [player]);
  return <View style={styles.root}>
    <Text style={styles.label}>Full source · {name}</Text>
    <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />
    <Text style={styles.label}>0:00 — {(sourcePreviewDurationMs(durationMs, decodedSeconds) / 1000).toFixed(1)}s · Use the playback timeline to seek</Text>
    {error !== null && <Text accessibilityRole="alert" style={styles.label}>{error}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 8 },
  label: { color: theme.textWeak, fontSize: 12 },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' }
});
