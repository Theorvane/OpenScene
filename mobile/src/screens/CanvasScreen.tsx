import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CANVAS_BLOCK_CATALOG, canvasDefaultInputCount, canvasVariableInputs, canvasSettings } from '@openvideo/shared/canvasBlockCatalog';
import { CANVAS_TEMPLATES } from '@openvideo/shared/canvasTemplates';
import { applyEditorOperations } from '@openvideo/shared/editorOperations';
import { CANVAS_LAYOUT_MODES } from '@openvideo/shared/canvasLayout';
import { projectEditorAssets } from '../lib/editorAssetMapping';
import { connectVideoClips } from '@openvideo/shared/videoCanvas';
import { applyCanvasBlock, evaluateCanvasBlock } from '@openvideo/shared/videoCanvasBlocks';
import { CANVAS_BLOCK_KINDS, CANVAS_BLOCK_LABELS, CANVAS_BLOCK_LIMIT, CANVAS_INPUT_LIMIT, EMPTY_CANVAS_GRAPH, canvasInputType, canvasSourceTimeline, connectCanvasInput, type VideoCanvasGraph } from '@openvideo/shared/videoCanvasGraph';
import type { TimelineDocument } from '@openvideo/shared/timelineTypes';
import { readProject, writeProject } from '../lib/projectStore';
import { useProject } from '../lib/useProject';
import { theme } from '../lib/theme';
import { press } from '../lib/touch';

export function CanvasScreen({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const [source, setSource] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [section, setSection] = useState<'templates' | 'workflow' | 'sources' | 'blocks'>('templates');
  const [selectedSources, setSelectedSources] = useState<readonly string[]>([]);
  const [selectedBlocks, setSelectedBlocks] = useState<readonly string[]>([]);
  const [finalId, setFinalId] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('Choose an output, then the next clip’s input.');
  const [undo, setUndo] = useState<{ before: TimelineDocument; after: TimelineDocument } | null>(null);
  if (project === null) return null;
  const graph = project.timeline.canvas ?? EMPTY_CANVAS_GRAPH;
  const inputTimeline = canvasSourceTimeline(project.timeline, graph);
  const runOperations = (operations: readonly unknown[]) => {
    const current = readProject(projectId); if (!current) return;
    const result = applyEditorOperations(current.timeline, operations, projectEditorAssets(current));
    if (!result.success) { setNotice(result.error); return; }
    writeProject({ ...current, timeline: result.timeline }); setUndo({ before: current.timeline, after: result.timeline });
    if (result.outputIds.length) setFinalId(result.outputIds.at(-1)!);
    setNotice('Workflow updated. Review its output before exporting.');
  };
  const roots = graph.blocks.filter(block => !graph.connections.some(edge => edge.fromId === block.id));
  const finalBlock = roots.find(block => block.id === finalId) ?? roots.at(-1);
  const finalResult = finalBlock ? evaluateCanvasBlock(project.timeline, graph, finalBlock.id) : null;
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
    const clip = inputTimeline.tracks.flatMap(track => track.clips).find(item => item.id === id);
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
    <Text style={styles.title}>Canvas workflow</Text>
    <Text style={styles.note}>Arrange selected nodes, or all nodes when none are selected. The desktop canvas uses these saved positions.</Text>
    <ScrollView horizontal>{CANVAS_LAYOUT_MODES.map(mode => <Pressable key={mode} accessibilityRole="button" style={press(styles.button)} onPress={() => runOperations([{ action: 'canvas.layout', mode, ids: [...selectedSources, ...selectedBlocks] }])}><Text style={styles.label}>{({ flow: 'Input → output', grid: 'Grid', 'align-left': 'Align left', 'align-top': 'Align top', 'distribute-horizontal': 'Space horizontally', 'distribute-vertical': 'Space vertically' })[mode]}</Text></Pressable>)}</ScrollView>
    <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => { setSelectedSources([]); setSelectedBlocks([]); }}><Text style={styles.label}>Clear node selection</Text></Pressable>
    <View style={styles.tabs}>{(['templates', 'workflow', 'sources', 'blocks'] as const).map(tab => <Pressable key={tab} accessibilityRole="button" accessibilityState={{ selected: section === tab }} style={press([styles.button, section === tab && styles.selected])} onPress={() => setSection(tab)}><Text style={styles.label}>{tab === 'templates' ? 'Quick starts' : tab[0]!.toUpperCase() + tab.slice(1)}</Text></Pressable>)}</View>
    {section === 'templates' && <View>
      <Text style={styles.note}>Select source cards or use matching inputs automatically. A quick start connects its blocks for you.</Text>
      {CANVAS_TEMPLATES.map(template => <Pressable key={template.id} accessibilityRole="button" style={press(styles.libraryItem)} onPress={() => {
        runOperations([{ action: 'canvas.template', templateId: template.id, prefix: 'flow-' + Date.now(), sourceIds: selectedSources }]); setSection('workflow');
      }}><Text style={styles.label}>{template.label}</Text><Text style={styles.note}>{template.description}</Text></Pressable>)}
      <Text style={styles.note}>{selectedSources.length} sources selected</Text>
      <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => setSelectedSources([])}><Text style={styles.label}>Clear selection</Text></Pressable>
    </View>}
    {finalBlock && <View style={styles.block}>
      <Text style={styles.label}>Final output: {CANVAS_BLOCK_LABELS[finalBlock.kind]}</Text>
      <ScrollView horizontal>{roots.map(block => <Pressable key={block.id} accessibilityRole="button" style={press(styles.button)} onPress={() => setFinalId(block.id)}><Text style={styles.label}>{CANVAS_BLOCK_LABELS[block.kind]}</Text></Pressable>)}</ScrollView>
      <Pressable accessibilityRole="button" disabled={!finalResult?.success} style={press(styles.button)} onPress={() => runOperations([{ action: 'canvas.apply', id: finalBlock.id }])}><Text style={styles.label}>Apply workflow</Text></Pressable>
    </View>}
    <Text style={styles.note}>Choose a clip or block output, then connect a matching block input. Apply a block to arrange its clips in Edit.</Text>
    {section === 'blocks' && <View style={styles.sequence}>
      <TextInput accessibilityLabel="Search blocks" placeholder="Search blocks…" placeholderTextColor={theme.textWeaker} style={styles.search} value={search} onChangeText={setSearch} />
      {CANVAS_BLOCK_KINDS.filter(kind => `${CANVAS_BLOCK_LABELS[kind]} ${CANVAS_BLOCK_CATALOG[kind].description}`.toLowerCase().includes(search.toLowerCase())).map(kind => <Pressable key={kind} accessibilityRole="button" disabled={graph.blocks.length >= CANVAS_BLOCK_LIMIT} style={press(styles.libraryItem)} onPress={() => {
        runOperations([{ action: 'canvas.add', id: 'block-' + Date.now() + '-' + Math.random().toString(36).slice(2), kind, inputCount: canvasDefaultInputCount(kind), x: 40, y: 40 + graph.blocks.length * 250 }]);
        setNotice('Block added. Connect each input.');
        setSection('workflow');
      }}><Text style={styles.note}>{CANVAS_BLOCK_CATALOG[kind].category.toUpperCase()}</Text><Text style={styles.label}>+ {CANVAS_BLOCK_LABELS[kind]}</Text><Text style={styles.note}>{CANVAS_BLOCK_CATALOG[kind].description}</Text></Pressable>)}
    </View>}
    {section !== 'blocks' && inputTimeline.tracks.map((track) => <View key={track.id}>
      <Text style={styles.label}>{track.name}</Text>
      <ScrollView horizontal contentContainerStyle={styles.sequence}>
        {[...track.clips].sort((a, b) => a.timelineStartMs - b.timelineStartMs).map((clip, index) => <View key={clip.id} style={styles.row}>
          {index > 0 && <Text style={styles.arrow}>→</Text>}
          <View style={[styles.card, source === clip.id && styles.selected]}>
            <Text style={styles.label}>{project.assets.find((asset) => asset.id === clip.assetId)?.displayName ?? 'Missing media'}</Text>
            <Text style={styles.note}>{(clip.sourceStartMs / 1000).toFixed(2)}–{(clip.sourceEndMs / 1000).toFixed(2)} s</Text>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selectedSources.includes(clip.id) }} style={press(styles.button)} onPress={() => setSelectedSources(current => current.includes(clip.id) ? current.filter(id => id !== clip.id) : [...current, clip.id])}><Text style={styles.label}>{selectedSources.includes(clip.id) ? '✓ Selected' : 'Use in quick start'}</Text></Pressable>
            {track.kind === 'video' && <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => setTarget(clip.id)}><Text style={styles.label}>● Input</Text></Pressable>}
            <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => { setSource(clip.id); setTarget(null); }}><Text style={styles.label}>Output ●</Text></Pressable>
          </View>
        </View>)}
      </ScrollView>
      {track.clips.length === 0 && <Text style={styles.note}>Add footage in Edit to start connecting clips.</Text>}
    </View>)}
    {section === 'workflow' && graph.blocks.map(block => {
      const result = evaluateCanvasBlock(project.timeline, graph, block.id);
      return <View key={block.id} style={[styles.block, source === block.id && styles.selected]}>
        <Text style={styles.label}>{CANVAS_BLOCK_LABELS[block.kind]}</Text>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selectedBlocks.includes(block.id) }} style={press(styles.button)} onPress={() => setSelectedBlocks(current => current.includes(block.id) ? current.filter(id => id !== block.id) : [...current, block.id])}><Text style={styles.label}>{selectedBlocks.includes(block.id) ? '✓ Selected node' : 'Select node'}</Text></Pressable>
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
        {canvasVariableInputs(block.kind) && block.inputCount < CANVAS_INPUT_LIMIT && <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => saveGraph({ ...graph, blocks: graph.blocks.map(item => item.id === block.id ? { ...item, inputCount: item.inputCount + 1 } : item) })}><Text style={styles.label}>+ Input</Text></Pressable>}
        {Object.entries(CANVAS_BLOCK_CATALOG[block.kind].settings ?? {}).map(([key, spec]) => <View key={key}>
          <Text style={styles.note}>{spec.label}</Text>
          {spec.options ? <ScrollView horizontal>{spec.options.map(value => <Pressable key={value} accessibilityRole="button" style={press(styles.button)} onPress={() => runOperations([{ action: 'canvas.configure', id: block.id, settings: { [key]: value } }])}><Text style={styles.label}>{canvasSettings(block)[key] === value ? '✓ ' : ''}{value}</Text></Pressable>)}</ScrollView>
            : <TextInput key={`${block.id}-${key}-${canvasSettings(block)[key]}`} accessibilityLabel={`${block.id} ${spec.label}`} defaultValue={String(canvasSettings(block)[key])} keyboardType="numbers-and-punctuation" style={styles.search} onEndEditing={event => {
              const value = Number(event.nativeEvent.text);
              if (event.nativeEvent.text.trim() && Number.isFinite(value)) runOperations([{ action: 'canvas.configure', id: block.id, settings: { [key]: value } }]);
            }} />}
        </View>)}
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
        <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => runOperations([{ action: 'canvas.remove', id: block.id }])}><Text style={styles.label}>Remove block</Text></Pressable>
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
    <Pressable accessibilityRole="button" style={press(styles.button)} onPress={() => runOperations([{ action: 'canvas.refreshSources' }])}><Text style={styles.label}>Refresh inputs from current timeline</Text></Pressable>
    <Text style={styles.note}>Free-position cards, frame inspection and speech analysis are available in the desktop editor.</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 16 },
  title: { color: theme.text, fontSize: 22, fontWeight: '600' },
  label: { color: theme.text, fontSize: 13 },
  note: { color: theme.textWeak, fontSize: 12, lineHeight: 18 },
  sequence: { paddingVertical: 12 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  search: { minHeight: 44, borderColor: theme.line, borderWidth: 1, color: theme.text, padding: 10, borderRadius: 8 },
  libraryItem: { minHeight: 80, padding: 14, borderColor: theme.line, borderWidth: 1, borderRadius: 10, gap: 8, marginTop: 12, backgroundColor: theme.surface },
  row: { flexDirection: 'row', alignItems: 'center' },
  arrow: { color: theme.textWeak, paddingHorizontal: 12 },
  card: { width: 180, borderColor: theme.textWeaker, borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  block: { borderColor: theme.textWeaker, borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  selected: { borderColor: theme.text, borderWidth: 2 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: theme.textWeaker, borderRadius: 8 }
});
