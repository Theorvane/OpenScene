import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { connectVideoClips } from '@openvideo/shared/videoCanvas';
import { applyCanvasBlock, evaluateCanvasBlock } from '@openvideo/shared/videoCanvasBlocks';
import { CANVAS_BLOCK_KINDS, CANVAS_BLOCK_LABELS, CANVAS_BLOCK_LIMIT, CANVAS_INPUT_LIMIT, EMPTY_CANVAS_GRAPH, canvasInputType, connectCanvasInput, type VideoCanvasGraph } from '@openvideo/shared/videoCanvasGraph';
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
  const graph = project.timeline.canvas ?? EMPTY_CANVAS_GRAPH;
  const saveGraph = (next: VideoCanvasGraph) => {
    const current = readProject(projectId);
    if (current === null) return;
    const timeline = { ...current.timeline, canvas: next };
    writeProject({ ...current, timeline });
    setUndo({ before: current.timeline, after: timeline });
  };
  const sourceName = (id: string) => {
    const block = graph.blocks.find(item => item.id === id);
    if (block) return CANVAS_BLOCK_LABELS[block.kind];
    const clip = project.timeline.tracks.flatMap(track => track.clips).find(item => item.id === id);
    return project.assets.find(asset => asset.id === clip?.assetId)?.displayName ?? 'Missing source';
  };
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
    <Text style={styles.note}>Choose a clip or block output, then connect a matching block input. Apply a block to arrange its clips in Edit.</Text>
    <View style={styles.sequence}>
      {CANVAS_BLOCK_KINDS.map(kind => <Pressable key={kind} accessibilityRole="button" disabled={graph.blocks.length >= CANVAS_BLOCK_LIMIT} style={press(styles.button)} onPress={() => {
        saveGraph({ ...graph, blocks: [...graph.blocks, { id: 'block-' + Date.now() + '-' + Math.random().toString(36).slice(2), kind, inputCount: 2, position: { x: 40, y: 40 + graph.blocks.length * 250 } }] });
        setNotice('Block added. Connect each input.');
      }}><Text style={styles.label}>+ {CANVAS_BLOCK_LABELS[kind]}</Text></Pressable>)}
    </View>
    {project.timeline.tracks.map((track) => <View key={track.id}>
      <Text style={styles.label}>{track.name}</Text>
      <ScrollView horizontal contentContainerStyle={styles.sequence}>
        {[...track.clips].sort((a, b) => a.timelineStartMs - b.timelineStartMs).map((clip, index) => <View key={clip.id} style={styles.row}>
          {index > 0 && <Text style={styles.arrow}>→</Text>}
          <View style={[styles.card, source === clip.id && styles.selected]}>
            <Text style={styles.label}>{project.assets.find((asset) => asset.id === clip.assetId)?.displayName ?? 'Missing media'}</Text>
            <Text style={styles.note}>{(clip.sourceStartMs / 1000).toFixed(2)}–{(clip.sourceEndMs / 1000).toFixed(2)} s</Text>
            {track.kind === 'video' && <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => setTarget(clip.id)}><Text style={styles.label}>● Input</Text></Pressable>}
            <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => { setSource(clip.id); setTarget(null); }}><Text style={styles.label}>Output ●</Text></Pressable>
          </View>
        </View>)}
      </ScrollView>
      {track.clips.length === 0 && <Text style={styles.note}>Add footage in Edit to start connecting clips.</Text>}
    </View>)}
    {graph.blocks.map(block => {
      const result = evaluateCanvasBlock(project.timeline, graph, block.id);
      return <View key={block.id} style={[styles.block, source === block.id && styles.selected]}>
        <Text style={styles.label}>{CANVAS_BLOCK_LABELS[block.kind]}</Text>
        <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => { setSource(block.id); setTarget(null); }}><Text style={styles.label}>Output ●</Text></Pressable>
        {Array.from({ length: block.inputCount }, (_, input) => {
          const edge = graph.connections.find(item => item.toId === block.id && item.input === input);
          return <View key={input}>
            <Text style={styles.note}>{canvasInputType(block, input)} {input + 1}: {edge ? sourceName(edge.fromId) : 'Not connected'}</Text>
            <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => {
              if (source === null) { setNotice('Choose an output first.'); return; }
              const connected = connectCanvasInput(project.timeline, graph, { fromId: source, toId: block.id, input });
              if (!connected.success) { setNotice(connected.error); return; }
              saveGraph(connected.graph); setSource(null); setNotice('Input connected.');
            }}><Text style={styles.label}>Connect input {input + 1}</Text></Pressable>
            {edge && <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => saveGraph({ ...graph, connections: graph.connections.filter(item => item !== edge) })}><Text style={styles.label}>Disconnect input {input + 1}</Text></Pressable>}
          </View>;
        })}
        {block.kind !== 'video-audio' && block.inputCount < CANVAS_INPUT_LIMIT && <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => saveGraph({ ...graph, blocks: graph.blocks.map(item => item.id === block.id ? { ...item, inputCount: item.inputCount + 1 } : item) })}><Text style={styles.label}>+ Input</Text></Pressable>}
        <Text style={styles.note}>{result.success ? (result.output.durationMs / 1000).toFixed(2) + ' s · starts at 0 s' : result.error}</Text>
        <Pressable accessibilityRole="button" disabled={!result.success} style={press(styles.button)} onPress={() => {
          const current = readProject(projectId);
          if (current === null) return;
          const applied = applyCanvasBlock(current.timeline, current.timeline.canvas ?? EMPTY_CANVAS_GRAPH, block.id);
          if (!applied.success) { setNotice(applied.error); return; }
          writeProject({ ...current, timeline: applied.timeline });
          setUndo({ before: current.timeline, after: applied.timeline });
          setSource(null); setTarget(null); setNotice('Block output applied. Open Edit to preview.');
        }}><Text style={styles.label}>Apply block</Text></Pressable>
        <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => saveGraph({ blocks: graph.blocks.filter(item => item.id !== block.id), connections: graph.connections.filter(item => item.toId !== block.id && item.fromId !== block.id) })}><Text style={styles.label}>Remove block</Text></Pressable>
      </View>;
    })}
    <Text accessibilityLiveRegion="polite" style={styles.note}>{notice}</Text>
    {source !== null && target !== null && <Pressable accessibilityRole="button" style={press(styles.button)} onPress={apply}><Text style={styles.label}>Apply connection</Text></Pressable>}
    {undo && <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => {
      const current = readProject(projectId);
      if (current === null || JSON.stringify(current.timeline) !== JSON.stringify(undo.after)) {
        setNotice('The timeline changed. Undo this connection before making other edits.'); return;
      }
      writeProject({ ...current, timeline: undo.before }); setUndo(null); setNotice('Connection undone.');
    }}><Text style={styles.label}>Undo canvas edit</Text></Pressable>}
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
  block: { borderColor: theme.textWeaker, borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  selected: { borderColor: theme.text, borderWidth: 2 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: theme.textWeaker, borderRadius: 8 }
});
