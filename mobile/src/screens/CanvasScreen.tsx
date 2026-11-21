import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { connectVideoClips } from '@openvideo/shared/videoCanvas';
import type { TimelineDocument } from '@openvideo/shared/timelineTypes';
import { readProject, writeProject } from '../lib/projectStore';
import { useProject } from '../lib/useProject';
import { theme } from '../lib/theme';
import { press } from '../lib/touch';

export function CanvasScreen({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const [source, setSource] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState('Choose an output, then the next clip’s input.');
  const [undo, setUndo] = useState<{ before: TimelineDocument; after: TimelineDocument } | null>(null);
  if (project === null) return null;
  const apply = () => {
    const current = readProject(projectId);
    if (current === null || source === null || target === null) return;
    const timeline = connectVideoClips(current.timeline, source, target);
    if (timeline === null) { setNotice('Choose different clips on the same video track.'); return; }
    writeProject({ ...current, timeline });
    setUndo({ before: current.timeline, after: timeline });
    setSource(null); setTarget(null);
    setNotice('Connection saved.');
  };
  return <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.title}>Canvas</Text>
    <Text style={styles.note}>Connect clips in playback order. Apply closes gaps on that video track.</Text>
    {project.timeline.tracks.filter((track) => track.kind === 'video').map((track) => <View key={track.id}>
      <Text style={styles.label}>{track.name}</Text>
      <ScrollView horizontal contentContainerStyle={styles.sequence}>
        {[...track.clips].sort((a, b) => a.timelineStartMs - b.timelineStartMs).map((clip, index) => <View key={clip.id} style={styles.row}>
          {index > 0 && <Text style={styles.arrow}>→</Text>}
          <View style={[styles.card, source === clip.id && styles.selected]}>
            <Text style={styles.label}>{project.assets.find((asset) => asset.id === clip.assetId)?.displayName ?? 'Missing media'}</Text>
            <Text style={styles.note}>{(clip.sourceStartMs / 1000).toFixed(2)}–{(clip.sourceEndMs / 1000).toFixed(2)} s</Text>
            <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => setTarget(clip.id)}><Text style={styles.label}>● Input</Text></Pressable>
            <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => { setSource(clip.id); setTarget(null); }}><Text style={styles.label}>Output ●</Text></Pressable>
          </View>
        </View>)}
      </ScrollView>
      {track.clips.length === 0 && <Text style={styles.note}>Add footage in Edit to start connecting clips.</Text>}
    </View>)}
    <Text accessibilityLiveRegion="polite" style={styles.note}>{notice}</Text>
    {source !== null && target !== null && <Pressable accessibilityRole="button" style={press(styles.button)} onPress={apply}><Text style={styles.label}>Apply connection</Text></Pressable>}
    {undo && <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => {
      const current = readProject(projectId);
      if (current === null || JSON.stringify(current.timeline) !== JSON.stringify(undo.after)) {
        setNotice('The timeline changed. Undo this connection before making other edits.'); return;
      }
      writeProject({ ...current, timeline: undo.before }); setUndo(null); setNotice('Connection undone.');
    }}><Text style={styles.label}>Undo connection</Text></Pressable>}
    <Text style={styles.note}>Free-position cards, frame inspection and speech analysis are available in the desktop editor.</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 16 },
  title: { color: theme.text, fontSize: 22, fontWeight: '600' },
  label: { color: theme.text, fontSize: 13 },
  note: { color: theme.textWeak, fontSize: 12, lineHeight: 18 },
  sequence: { paddingVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  arrow: { color: theme.textWeak, paddingHorizontal: 12 },
  card: { width: 180, borderColor: theme.textWeaker, borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  selected: { borderColor: theme.text, borderWidth: 2 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: theme.textWeaker, borderRadius: 8 }
});
