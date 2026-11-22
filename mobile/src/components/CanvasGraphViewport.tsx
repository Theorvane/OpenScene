import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { fitCanvasBounds, zoomCanvasAt, type CanvasCamera } from '@openvideo/shared/canvasViewport';
import { theme } from '../lib/theme';
import { press } from '../lib/touch';

export type GraphCard = { readonly id: string; readonly label: string; readonly detail: string; readonly kind: string; readonly x: number; readonly y: number; readonly inputs: number; readonly colour: string; readonly ready?: boolean; readonly thumbnail?: string };
type Edge = { readonly fromId: string; readonly toId: string; readonly input: number };
const WIDTH = 176, HEIGHT = 108;
function Segment({ x1, y1, x2, y2, colour }: { x1: number; y1: number; x2: number; y2: number; colour: string }) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  return <View pointerEvents="none" style={{ position: 'absolute', width: length, height: 2, backgroundColor: colour, left: (x1 + x2 - length) / 2, top: (y1 + y2) / 2, transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }] }} />;
}
function Card({ node, selected, connecting, zoom, onSelect, onOutput, onInput, onMove }: { node: GraphCard; selected: boolean; connecting: boolean; zoom: number; onSelect: () => void; onOutput: () => void; onInput: (input: number) => void; onMove: (x: number, y: number) => void }) {
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const current = useRef({ node, zoom, onMove }); current.current = { node, zoom, onMove };
  const start = useRef({ x: 0, y: 0 });
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 8,
    onPanResponderGrant: () => { start.current = { x: current.current.node.x, y: current.current.node.y }; },
    onPanResponderMove: (_event, gesture) => setDrag({ x: Math.max(0, start.current.x + gesture.dx / current.current.zoom), y: Math.max(0, start.current.y + gesture.dy / current.current.zoom) }),
    onPanResponderRelease: (_event, gesture) => { current.current.onMove(Math.max(0, start.current.x + gesture.dx / current.current.zoom), Math.max(0, start.current.y + gesture.dy / current.current.zoom)); setDrag(null); },
    onPanResponderTerminate: () => setDrag(null)
  }), []);
  return <View style={[styles.card, { left: drag?.x ?? node.x, top: drag?.y ?? node.y, borderColor: selected || connecting ? theme.accent : '#454b58', borderWidth: selected || connecting ? 2 : 1 }]}>
    <View {...responder.panHandlers} style={styles.cardHeader}><View style={[styles.kindMark, { backgroundColor: node.colour }]} /><Text style={styles.kind}>{node.kind}</Text><Text style={styles.grip}>⠿</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Select ${node.label} ${node.id}`} accessibilityState={{ selected }} onPress={onSelect} style={press(styles.cardBody)}>
      {node.thumbnail && <Image source={{ uri: node.thumbnail }} style={styles.thumbnail} />}
      <Text numberOfLines={1} style={styles.cardTitle}>{node.label}</Text><Text numberOfLines={1} style={styles.cardDetail}>{node.detail}</Text>
    </Pressable>
    <View style={styles.ports}>
      <View style={styles.inputPorts}>{Array.from({ length: Math.min(3, node.inputs) }, (_, input) => <Pressable key={input} accessibilityRole="button" accessibilityLabel={`Connect ${node.id} input ${input + 1}`} onPress={() => onInput(input)} hitSlop={10} style={styles.portHit}><View style={[styles.port, { borderColor: node.colour }]} /><Text style={styles.portText}>{input + 1}</Text></Pressable>)}{node.inputs > 3 && <Pressable accessibilityRole="button" accessibilityLabel={`Edit all ${node.inputs} inputs`} onPress={onSelect} hitSlop={10}><Text style={styles.portText}>+{node.inputs - 3}</Text></Pressable>}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Connect from ${node.id}`} accessibilityState={{ selected: connecting }} onPress={onOutput} hitSlop={8} style={styles.portHit}><Text style={[styles.portText, { color: connecting ? theme.accent : theme.textWeak }]}>OUT</Text><View style={[styles.port, { backgroundColor: node.colour, borderColor: node.colour }]} /></Pressable>
    </View>
  </View>;
}
export function CanvasGraphViewport({ nodes, edges, selection, connectingId, fitKey, onSelect, onOutput, onInput, onMove, onAdd }: {
  nodes: readonly GraphCard[]; edges: readonly Edge[]; selection: readonly string[]; connectingId: string | null; fitKey: number;
  onSelect: (id: string) => void; onOutput: (id: string) => void; onInput: (id: string, input: number) => void; onMove: (id: string, x: number, y: number) => void; onAdd: () => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<CanvasCamera>({ x: 24, y: 32, zoom: 0.85 });
  const live = useRef({ camera, size }); live.current = { camera, size };
  const start = useRef<CanvasCamera>(camera), pinch = useRef<{ distance: number; x: number; y: number } | null>(null);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.numberActiveTouches > 1 || Math.abs(gesture.dx) + Math.abs(gesture.dy) > 6,
    onPanResponderGrant: event => { start.current = live.current.camera; const [a, b] = event.nativeEvent.touches; pinch.current = a && b ? { distance: Math.hypot(b.pageX - a.pageX, b.pageY - a.pageY), x: (a.locationX + b.locationX) / 2, y: (a.locationY + b.locationY) / 2 } : null; },
    onPanResponderMove: (event, gesture) => {
      const [a, b] = event.nativeEvent.touches;
      if (a && b && pinch.current) { const distance = Math.hypot(b.pageX - a.pageX, b.pageY - a.pageY); setCamera(zoomCanvasAt(start.current, start.current.zoom * distance / Math.max(1, pinch.current.distance), pinch.current)); }
      else setCamera({ ...start.current, x: start.current.x + gesture.dx, y: start.current.y + gesture.dy });
    }, onPanResponderRelease: () => { pinch.current = null; }
  }), []);
  const fit = (overview = false) => {
    if (!nodes.length || !size.width) return;
    const x = Math.min(...nodes.map(node => node.x)), y = Math.min(...nodes.map(node => node.y));
    const bounds = { x, y, width: Math.max(...nodes.map(node => node.x + WIDTH)) - x, height: Math.max(...nodes.map(node => node.y + HEIGHT)) - y };
    const fitted = fitCanvasBounds(bounds, size.width, Math.max(120, size.height - 70));
    setCamera(overview || fitted.zoom >= 0.85 ? fitted : { zoom: 0.85, x: 24 - x * 0.85, y: Math.max(74, (size.height - 80 - bounds.height * 0.85) / 2) - y * 0.85 });
  };
  useEffect(() => fit(), [fitKey, size.width, size.height]);
  useEffect(() => {
    if (selection.length !== 1) return;
    const node = nodes.find(node => node.id === selection[0]);
    if (node) setCamera(current => ({ ...current, x: size.width / 2 - (node.x + WIDTH / 2) * current.zoom, y: 72 - node.y * current.zoom }));
  }, [selection[0], selection.length]);
  const zoom = (factor: number) => setCamera(current => zoomCanvasAt(current, current.zoom * factor, { x: size.width / 2, y: size.height / 2 }));
  return <View style={styles.viewport} onLayout={event => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
    <View style={StyleSheet.absoluteFill} {...pan.panHandlers}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>{Array.from({ length: Math.ceil(size.height / 24) }, (_, row) => <View key={row} style={[styles.dotRow, { top: row * 24 + ((camera.y % 24) + 24) % 24 }]}>{Array.from({ length: Math.ceil(size.width / 24) + 1 }, (_, column) => <View key={column} style={styles.dot} />)}</View>)}</View>
      <View style={{ position: 'absolute', left: camera.x, top: camera.y, width: Math.max(1, ...nodes.map(node => node.x + WIDTH)), height: Math.max(1, ...nodes.map(node => node.y + HEIGHT)), transformOrigin: 'top left', transform: [{ scale: camera.zoom }] }}>
        {edges.map(edge => { const source = nodes.find(node => node.id === edge.fromId), target = nodes.find(node => node.id === edge.toId); if (!source || !target) return null; const x1 = source.x + WIDTH, y1 = source.y + HEIGHT - 16, x2 = target.x, y2 = target.y + HEIGHT - 16, mid = (x1 + x2) / 2; return <View key={`${edge.toId}-${edge.input}`} pointerEvents="none"><Segment x1={x1} y1={y1} x2={mid} y2={y1} colour={source.colour}/><Segment x1={mid} y1={y1} x2={mid} y2={y2} colour={source.colour}/><Segment x1={mid} y1={y2} x2={x2} y2={y2} colour={source.colour}/></View>; })}
        {nodes.map(node => <Card key={node.id} node={node} selected={selection.includes(node.id)} connecting={connectingId === node.id} zoom={camera.zoom} onSelect={() => onSelect(node.id)} onOutput={() => onOutput(node.id)} onInput={input => onInput(node.id, input)} onMove={(x, y) => onMove(node.id, x, y)} />)}
      </View>
    </View>
    {!nodes.length && <View style={styles.empty}><Text style={styles.emptyGlyph}>◇</Text><Text style={styles.emptyTitle}>Build your edit</Text><Text style={styles.emptyNote}>Add media and connect a few blocks.{ '\n' }Your timeline stays one tap away.</Text><Pressable accessibilityRole="button" onPress={onAdd} style={press(styles.emptyButton)}><Text style={styles.emptyButtonText}>＋ Add to canvas</Text></Pressable></View>}
    <View style={styles.zoomBar}><Pressable accessibilityRole="button" accessibilityLabel="Zoom out canvas" onPress={() => zoom(1 / 1.2)} style={styles.tool}><Text style={styles.toolText}>−</Text></Pressable><Text style={styles.zoomValue}>{Math.round(camera.zoom * 100)}%</Text><Pressable accessibilityRole="button" accessibilityLabel="Zoom in canvas" onPress={() => zoom(1.2)} style={styles.tool}><Text style={styles.toolText}>＋</Text></Pressable><View style={styles.divider}/><Pressable accessibilityRole="button" accessibilityLabel="Fit canvas" onPress={() => fit(true)} style={styles.tool}><Text style={styles.toolText}>⤢</Text></Pressable></View>
  </View>;
}
const styles = StyleSheet.create({
  viewport: { flex: 1, backgroundColor: '#12151b', overflow: 'hidden' }, dotRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', gap: 22 }, dot: { width: 2, height: 2, backgroundColor: '#303541', borderRadius: 1 },
  card: { position: 'absolute', width: WIDTH, height: HEIGHT, borderRadius: 12, backgroundColor: '#252a34', boxShadow: '0px 5px 14px #00000035' }, cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 26, borderBottomWidth: 1, borderBottomColor: '#343b47' }, kindMark: { width: 5, height: 5, borderRadius: 2 }, kind: { color: theme.textWeak, fontSize: 11, flex: 1 }, grip: { color: theme.textWeaker, fontSize: 13 }, cardBody: { paddingHorizontal: 10, height: 51, justifyContent: 'center', gap: 4 }, cardTitle: { color: theme.text, fontSize: 12, fontWeight: '600' }, cardDetail: { color: theme.textWeak, fontSize: 11 }, thumbnail: { position: 'absolute', top: 0, right: 0, width: 44, height: 50, opacity: 0.3 },
  ports: { height: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 7 }, inputPorts: { flexDirection: 'row', gap: 3 }, portHit: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 24 }, port: { width: 8, height: 8, borderWidth: 1.5, borderRadius: 4 }, portText: { color: theme.textWeak, fontSize: 11 },
  zoomBar: { position: 'absolute', right: 14, bottom: 18, flexDirection: 'row', alignItems: 'center', backgroundColor: '#252a34', borderRadius: 12, borderWidth: 1, borderColor: '#414856', height: 44 }, tool: { width: 38, height: 44, alignItems: 'center', justifyContent: 'center' }, toolText: { color: theme.text, fontSize: 20 }, zoomValue: { color: theme.textWeak, fontSize: 11, minWidth: 32, textAlign: 'center' }, divider: { height: 18, width: 1, backgroundColor: theme.line },
  empty: { position: 'absolute', left: 24, right: 24, top: '24%', alignItems: 'center', gap: 14 }, emptyGlyph: { color: theme.accent, fontSize: 48 }, emptyTitle: { color: theme.text, fontWeight: '600', fontSize: 21 }, emptyNote: { color: theme.textWeak, fontSize: 13, lineHeight: 21, textAlign: 'center' }, emptyButton: { backgroundColor: theme.accent, borderRadius: 10, padding: 14 }, emptyButtonText: { color: '#14223d', fontWeight: '600' }
});
