import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { MediaAsset, PersistedTimelineClip, TimelineDocument } from '../../../shared/timelineTypes';
import { clipDurationMs } from '../../../shared/timelineClipGeometry';
import { applyCanvasBlock, evaluateCanvasBlock } from '../../../shared/videoCanvasBlocks';
import { NodeWorkflowImpactPanel } from '../../components/workspace';
import { describeCanvasApplyImpact } from './canvasApplyImpact';
import { CANVAS_BLOCK_CATALOG, canvasDefaultInputCount, canvasVariableInputs } from '../../../shared/canvasBlockCatalog';
import { CANVAS_TEMPLATES, createCanvasTemplate, type CanvasTemplateId } from '../../../shared/canvasTemplates';
import { CanvasBlockSettings } from './CanvasBlockSettings';
import { canvasBlockHeight, layoutCanvas, type CanvasLayoutMode } from '../../../shared/canvasLayout';
import {
  CANVAS_BLOCK_KINDS, CANVAS_BLOCK_LABELS, CANVAS_BLOCK_LIMIT, CANVAS_INPUT_LIMIT,
  EMPTY_CANVAS_GRAPH, canvasInputType, canvasOutputType, canvasPortMatches, canvasSourceTimeline, connectCanvasInput,
  type CanvasBlock, type CanvasBlockKind, type CanvasPosition
} from '../../../shared/videoCanvasGraph';
import { formatDuration } from '../format';
import { useAssetPlaybackUrl } from './TimelineCanvas';
import { useClipThumbnails } from './clipThumbnails';
import type { TimelineEditorController } from './useTimelineEditor';

type Position = { x: number; y: number };
type Positions = Record<string, Position>;

function readPositions(key: string): Positions {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, Position] => {
      const value = entry[1] as Position | null;
      return value !== null && typeof value === 'object' && Number.isFinite(value.x) && Number.isFinite(value.y) &&
        value.x >= 0 && value.y >= 0 && value.x <= 20000 && value.y <= 20000;
    }));
  } catch { return {}; }
}

function ClipPicture({ projectId, asset, clip }: { projectId: string; asset: MediaAsset; clip: PersistedTimelineClip }) {
  const url = useAssetPlaybackUrl(projectId, asset.id);
  const frames = useClipThumbnails({ assetId: asset.id, url, clip, widthPx: 64 });
  return frames[0] ? <img src={frames[0]} alt={asset.displayName} draggable={false} /> :
    <span className="video-node__placeholder">{asset.kind === 'image' && url ? <img src={url} alt={asset.displayName} /> : 'Preview loading'}</span>;
}

function AudioPicture({ projectId, asset }: { projectId: string; asset: MediaAsset }) {
  const url = useAssetPlaybackUrl(projectId, asset.id);
  return <div className="video-node__audio">
    <span>Audio source</span>
    {url !== null && <audio src={url} controls preload="metadata" aria-label={`Listen to ${asset.displayName}`} />}
  </div>;
}

export function VideoConnectionCanvas({ editor, locked, onPreview }: {
  editor: TimelineEditorController;
  locked: boolean;
  onPreview: () => void;
}) {
  const project = editor.project!;
  const storageKey = `openvideo-canvas-layout-${project.id}`;
  const [positions, setPositions] = useState<Positions>(() => readPositions(storageKey));
  const [zoom, setZoom] = useState(1);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [libraryTab, setLibraryTab] = useState<'templates' | 'blocks' | 'sources'>('templates');
  const [selectedSources, setSelectedSources] = useState<readonly string[]>([]);
  const [selectedBlocks, setSelectedBlocks] = useState<readonly string[]>([]);
  const [layoutMode, setLayoutMode] = useState<CanvasLayoutMode>('flow');
  const [finalId, setFinalId] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingApply, setPendingApply] = useState<{ readonly blockId: string; readonly before: TimelineDocument; readonly after: TimelineDocument } | null>(null);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const graph = project.timeline.canvas ?? EMPTY_CANVAS_GRAPH;
  const tracks = canvasSourceTimeline(project.timeline, graph).tracks;
  const roots = graph.blocks.filter(block => !graph.connections.some(edge => edge.fromId === block.id));
  const finalBlock = roots.find(block => block.id === finalId) ?? roots.at(-1);
  const finalResult = finalBlock ? evaluateCanvasBlock(project.timeline, graph, finalBlock.id) : null;
  const requestApply = (blockId: string): void => {
    const result = applyCanvasBlock(project.timeline, graph, blockId);
    if (!result.success) { setNotice(result.error); return; }
    setPendingApply({ blockId, before: project.timeline, after: result.timeline });
  };
  const pendingIsCurrent = pendingApply !== null && pendingApply.before === project.timeline;
  const blockHeight = canvasBlockHeight;
  useEffect(() => {
    // Keep source cards in place when applying a block moves clips between tracks.
    setPositions(current => {
      const missing = tracks.flatMap((track, row) => [...track.clips]
        .sort((a, b) => a.timelineStartMs - b.timelineStartMs)
        .map((clip, column) => ({ clip, x: 48 + column * 290, y: 48 + row * 260 })))
        .filter(item => current[item.clip.id] === undefined);
      if (missing.length === 0) return current;
      const next = { ...current };
      for (const item of missing) {
        let y = item.y;
        while (y < 19700 && graph.blocks.some(block =>
          item.x < block.position.x + 300 && item.x + 260 > block.position.x &&
          y < block.position.y + 180 + block.inputCount * 42 && y + 230 > block.position.y)) y += 260;
        next[item.clip.id] = { x: item.x, y };
      }
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep layout in memory. */ }
      return next;
    });
  }, [tracks, graph.blocks, storageKey]);
  const nodes = tracks.flatMap((track, row) => [...track.clips]
    .sort((left, right) => left.timelineStartMs - right.timelineStartMs)
    .map((clip, column) => ({
      clip, track, asset: project.assets.find((asset) => asset.id === clip.assetId),
      position: (draggingBlockId === clip.id ? positions[clip.id] : graph.sourcePositions?.[clip.id]) ?? positions[clip.id] ?? { x: 48 + column * 290, y: 48 + row * 260 }
    })));
  const source = nodes.find((node) => node.clip.id === fromId);
  const target = nodes.find((node) => node.clip.id === toId);
  const blockPosition = (block: CanvasBlock): CanvasPosition =>
    draggingBlockId === block.id ? positions[block.id] ?? block.position : block.position;
  const width = Math.max(1200, ...nodes.map(node => node.position.x + 320), ...graph.blocks.map(block => blockPosition(block).x + 360));
  const height = Math.max(500, ...nodes.map(node => node.position.y + 270), ...graph.blocks.map(block => blockPosition(block).y + blockHeight(block)));

  const moveNode = (event: PointerEvent<HTMLElement>, id: string, initial: Position) => {
    if (event.button !== 0 || locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingBlockId(id);
    const origin = { x: event.clientX, y: event.clientY };
    const element = event.currentTarget;
    let finalPosition = initial;
    const move = (next: globalThis.PointerEvent) => {
      const position = {
        x: Math.round(Math.min(20000, Math.max(0, initial.x + (next.clientX - origin.x) / zoom))),
        y: Math.round(Math.min(20000, Math.max(0, initial.y + (next.clientY - origin.y) / zoom)))
      };
      finalPosition = position;
      setPositions((current) => {
        const updated = { ...current, [id]: position };
        try { localStorage.setItem(storageKey, JSON.stringify(updated)); } catch { /* Layout remains usable in memory. */ }
        return updated;
      });
    };
    const stop = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', stop);
      element.removeEventListener('pointercancel', stop);
      setDraggingBlockId(null);
      if (graph.blocks.some(block => block.id === id) && (finalPosition.x !== initial.x || finalPosition.y !== initial.y)) {
        editor.updateCanvasGraph({
          ...graph, blocks: graph.blocks.map(block => block.id === id ? { ...block, position: finalPosition } : block)
        });
      } else if (finalPosition.x !== initial.x || finalPosition.y !== initial.y) {
        editor.updateCanvasGraph({ ...graph, sourcePositions: { ...graph.sourcePositions, [id]: finalPosition } });
      }
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', stop);
    element.addEventListener('pointercancel', stop);
  };

  const chooseTarget = (id: string) => {
    const next = nodes.find((node) => node.clip.id === id);
    if (source === undefined || next === undefined || source.clip.id === id || source.track.id !== next.track.id) {
      setNotice('Choose a different clip on the same video track.');
      return;
    }
    setNotice('');
    setToId(id);
  };

  const addBlock = (blockKind: CanvasBlockKind) => {
    const position = { x: 48 + graph.blocks.length * 300, y: Math.min(20000, Math.max(48, ...nodes.map(node => node.position.y + 270))) };
    const block: CanvasBlock = { id: 'block-' + crypto.randomUUID(), kind: blockKind, inputCount: canvasDefaultInputCount(blockKind), position };
    const operations: unknown[] = [{ action: 'canvas.add', id: block.id, kind: block.kind, x: position.x, y: position.y }];
    const autoConnect = fromId !== null && canvasPortMatches(canvasOutputType(project.timeline, graph, fromId), canvasInputType(block, 0));
    if (autoConnect) operations.push({ action: 'canvas.connect', fromId, toId: block.id, input: 0 });
    if (editor.applyEditingOperations(operations)) {
      if (autoConnect) setFromId(block.id);
      setFinalId(block.id);
      setNotice('Select a source output, then an input on the block.');
      requestAnimationFrame(() => viewport.current?.scrollTo({ left: position.x * zoom, top: position.y * zoom, behavior: 'smooth' }));
    }
  };
  const addTemplate = (templateId: CanvasTemplateId) => {
    try {
      const prefix = 'flow-' + crypto.randomUUID();
      const result = createCanvasTemplate(project.timeline, graph, templateId, prefix, selectedSources);
      if (editor.applyEditingOperations([{ action: 'canvas.template', templateId, prefix, sourceIds: selectedSources }])) {
        setFinalId(result.rootId); setFromId(null); setToId(null);
        setNotice('Ready-made connections added. Adjust any settings, then Apply workflow.');
      }
    } catch (error: unknown) { setNotice(error instanceof Error ? error.message : 'Choose matching source clips.'); }
  };
  const fitView = () => {
    if (viewport.current === null) return;
    const right = Math.max(400, ...nodes.map(node => node.position.x + 280), ...graph.blocks.map(block => block.position.x + 320));
    const bottom = Math.max(300, ...nodes.map(node => node.position.y + 250), ...graph.blocks.map(block => block.position.y + blockHeight(block)));
    setZoom(Math.max(.2, Math.min(1.2, (viewport.current.clientWidth - 40) / right, (viewport.current.clientHeight - 40) / bottom)));
    viewport.current.scrollTo({ left: 0, top: 0 });
  };
  const arrange = (mode: CanvasLayoutMode = 'flow', selected = false) => {
    try {
      const ids = [...selectedSources, ...selectedBlocks].filter(id => nodes.some(node => node.clip.id === id) || graph.blocks.some(block => block.id === id));
      const current = { ...graph, sourcePositions: { ...graph.sourcePositions, ...Object.fromEntries(nodes.map(node => [node.clip.id, node.position])) } };
      editor.updateCanvasGraph(layoutCanvas(project.timeline, current, mode, selected ? ids : undefined));
      setNotice('Node arrangement saved. Connections and media are unchanged. Use Undo to restore the layout.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to arrange nodes.'); }
  };
  const connectBlock = (block: CanvasBlock, input: number) => {
    if (fromId === null) { setNotice('Select a source or block output first.'); return; }
    const result = connectCanvasInput(project.timeline, graph, { fromId, toId: block.id, input });
    if (!result.success) { setNotice(result.error); return; }
    editor.updateCanvasGraph(result.graph);
    setFromId(null); setToId(null);
    setNotice('Input connected. Complete the remaining inputs, then apply the block.');
  };
  const inputLabel = (block: CanvasBlock, index: number) =>
    ({ video: 'Video', audio: 'Audio', 'video-audio': 'Video + audio', media: 'Media', visual: 'Picture' })[canvasInputType(block, index)] + (block.inputCount === 1 || block.kind === 'video-audio' ? '' : ' ' + (index + 1));
  const sourceName = (id: string) => {
    const block = graph.blocks.find(candidate => candidate.id === id);
    return nodes.find(node => node.clip.id === id)?.asset?.displayName ??
      (block === undefined ? 'Missing source' : CANVAS_BLOCK_LABELS[block.kind]);
  };

  return <NodeWorkflowImpactPanel workflowTitle="프로젝트 워크플로"
    impactSummary={pendingIsCurrent ? describeCanvasApplyImpact(pendingApply.before, pendingApply.after, sourceName(pendingApply.blockId)) : null}
    onCancelApply={() => setPendingApply(null)}
    {...(pendingIsCurrent && !locked ? { onConfirmApply: () => {
      if (pendingApply.before !== editor.project?.timeline) return;
      if (editor.applyCanvasBlock(pendingApply.blockId)) {
        setFromId(null); setToId(null); setNotice('워크플로를 적용했습니다. 실행 취소로 직전 타임라인을 복원할 수 있습니다.');
      } else setNotice('적용하지 못했습니다. 편집기 상태를 확인하세요.');
      setPendingApply(null);
    } } : {})}
  ><section className="video-canvas canvas-workbench" aria-label="Video connection canvas">
    <aside className="canvas-library" aria-label="Workflow library">
      <div className="canvas-library__tabs" role="group" aria-label="Workflow library categories">
        <button type="button" aria-pressed={libraryTab === 'templates'} onClick={() => { setLibraryTab('templates'); setSearch(''); }}>Quick starts</button>
        <button type="button" aria-pressed={libraryTab === 'blocks'} onClick={() => { setLibraryTab('blocks'); setSearch(''); }}>Blocks</button>
        <button type="button" aria-pressed={libraryTab === 'sources'} onClick={() => { setLibraryTab('sources'); setSearch(''); }}>Sources</button>
      </div>
      <input aria-label="Search workflow library" placeholder={libraryTab === 'blocks' ? 'Search blocks…' : 'Search media…'} value={search} onChange={event => setSearch(event.target.value)} />
      {libraryTab === 'templates' ? <div className="canvas-library__items">
        <p className="canvas-library__eyebrow">START WITH A RESULT</p>
        <p className="canvas-library__hint">Check source cards to choose footage, or let us use matching sources in timeline order.</p>
        {CANVAS_TEMPLATES.filter(template => `${template.label} ${template.description}`.toLowerCase().includes(search.toLowerCase())).map(template =>
          <button type="button" className="canvas-library__item" key={template.id} disabled={locked} aria-label={`Create ${template.label}`} onClick={() => addTemplate(template.id)}>
            <strong>{template.label} ＋</strong><small>{template.description}</small>
          </button>)}
        <p className="canvas-library__hint">{selectedSources.length} sources selected</p>
        {selectedSources.length > 0 && <button type="button" onClick={() => setSelectedSources([])}>Clear selection</button>}
      </div> : libraryTab === 'blocks' ? <div className="canvas-library__items">
        <p className="canvas-library__eyebrow">FUNCTION BLOCKS</p>
        {CANVAS_BLOCK_KINDS.filter(kind => `${CANVAS_BLOCK_LABELS[kind]} ${CANVAS_BLOCK_CATALOG[kind].description}`.toLowerCase().includes(search.toLowerCase())).map(kind =>
          <button className="canvas-library__item" type="button" key={kind} aria-label={`Add ${CANVAS_BLOCK_LABELS[kind]}`}
            disabled={locked || graph.blocks.length >= CANVAS_BLOCK_LIMIT} onClick={() => addBlock(kind)}>
            <span className={`canvas-library__badge canvas-library__badge--${CANVAS_BLOCK_CATALOG[kind].category.toLowerCase()}`}>{CANVAS_BLOCK_CATALOG[kind].category}</span>
            <strong>{CANVAS_BLOCK_LABELS[kind]} <span aria-hidden="true">＋</span></strong>
            <small>{CANVAS_BLOCK_CATALOG[kind].description}</small>
          </button>)}
      </div> : <div className="canvas-library__items">
        <button type="button" disabled={locked} onClick={() => { void editor.importAssets(); }}>+ Import media</button>
        {project.assets.filter(asset => asset.displayName.toLowerCase().includes(search.toLowerCase())).map(asset =>
          <button className="canvas-library__item" type="button" key={asset.id} disabled={locked} aria-label={`Add source ${asset.displayName}`} onClick={() => editor.placeAssetOnTimeline(asset.id)}>
            <span className="canvas-library__badge">{asset.kind}</span><strong>{asset.displayName}</strong>
            <small>Add a source clip · {asset.metadata ? formatDuration(asset.metadata.durationMs) : 'Reading metadata'}</small>
          </button>)}
        {project.assets.length === 0 && <p>Import a video or audio file to start.</p>}
      </div>}
      <p className="canvas-library__hint">Choose a quick start, or add blocks. Input menus show compatible sources, so dragging wires is optional.</p>
    </aside>
    <div className="canvas-stage">
    <div className="video-canvas__toolbar">
      <strong>Workflow <small>{nodes.length} sources · {graph.blocks.length} blocks</small></strong>
      <select aria-label="Final workflow output" value={finalBlock?.id ?? ''} onChange={event => setFinalId(event.currentTarget.value)}>
        {!finalBlock && <option value="">Choose an output</option>}
        {roots.map(block => <option key={block.id} value={block.id}>{CANVAS_BLOCK_LABELS[block.kind]}</option>)}
      </select>
      <button type="button" disabled={locked || !finalBlock || !finalResult?.success} onClick={() => {
        if (finalBlock) requestApply(finalBlock.id);
      }}>적용 영향 확인</button>
      <button type="button" onClick={onPreview}>Review timeline</button>
      <button type="button" disabled={locked || !editor.canUndoTimeline} onClick={() => {
        editor.undoTimeline(); setFromId(null); setToId(null); setNotice('Canvas edit undone.');
      }}>Undo</button>
      <button type="button" disabled={locked || !editor.canRedoTimeline} onClick={() => {
        editor.redoTimeline(); setFromId(null); setToId(null); setNotice('Canvas edit restored.');
      }}>Redo</button>
      <button type="button" disabled={locked} onClick={() => arrange()}>Auto arrange</button>
      <button type="button" onClick={fitView}>Fit</button>
      <button type="button" aria-label="Zoom out canvas" onClick={() => setZoom(Math.max(.2, zoom - .1))}>−</button>
      <button type="button" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Zoom in canvas" onClick={() => setZoom(Math.min(1.8, zoom + .1))}>+</button>
      <button type="button" disabled={locked} title="Use the current timeline as fresh source ranges. This can be undone." onClick={() => { if (editor.applyEditingOperations([{ action: 'canvas.refreshSources' }])) setNotice('Inputs refreshed from the current timeline.'); }}>Refresh inputs</button>
    </div>
    <div className="canvas-layout-tools" role="group" aria-label="Node arrangement tools">
      <span>{selectedSources.length + selectedBlocks.length} nodes selected · empty selection uses all nodes</span>
      <select aria-label="Node arrangement" value={layoutMode} onChange={event => setLayoutMode(event.currentTarget.value as CanvasLayoutMode)}>
        <option value="flow">Input → output</option><option value="grid">Grid</option><option value="align-left">Align left</option><option value="align-top">Align top</option>
        <option value="distribute-horizontal">Space horizontally</option><option value="distribute-vertical">Space vertically</option>
      </select>
      <button type="button" disabled={locked} onClick={() => arrange(layoutMode, true)}>Arrange nodes</button>
      <button type="button" onClick={() => { setSelectedSources([]); setSelectedBlocks([]); }}>Clear node selection</button>
    </div>
    <div ref={viewport} className="video-canvas__scroll" tabIndex={0} aria-label="Scrollable canvas">
      <div style={{ width: width * zoom, height: height * zoom }}>
        <div className="video-canvas__plane" style={{ width, height, transform: `scale(${zoom})` }}>
          <svg className="video-canvas__wires" width={width} height={height} aria-hidden="true">
            {nodes.map((node, index) => {
              const next = nodes[index + 1];
              if (next === undefined || next.track.id !== node.track.id) return null;
              const startX = node.position.x + 240;
              const endX = next.position.x;
              return <path className="video-canvas__playback-wire" key={node.clip.id} d={`M ${startX} ${node.position.y + 105} C ${startX + 70} ${node.position.y + 105}, ${endX - 70} ${next.position.y + 105}, ${endX} ${next.position.y + 105}`} />;
            })}
            {graph.connections.map(edge => {
              const sourceNode = nodes.find(node => node.clip.id === edge.fromId);
              const sourceBlock = graph.blocks.find(block => block.id === edge.fromId);
              const targetBlock = graph.blocks.find(block => block.id === edge.toId);
              if ((sourceNode === undefined && sourceBlock === undefined) || targetBlock === undefined) return null;
              const from = sourceNode?.position ?? blockPosition(sourceBlock!);
              const to = blockPosition(targetBlock);
              const startX = from.x + (sourceNode ? 240 : 280);
              const startY = from.y + (sourceNode ? 205 : 58);
              const endY = to.y + 100 + edge.input * 42;
              return <path className={`video-canvas__connection video-canvas__connection--${canvasInputType(targetBlock, edge.input)}`}
                key={edge.toId + '/' + edge.input}
                d={`M ${startX} ${startY} C ${startX + 70} ${startY}, ${to.x - 70} ${endY}, ${to.x} ${endY}`} />;
            })}
          </svg>
          {nodes.map(({ clip, asset, track, position }) => <article key={clip.id}
            className={`video-node${editor.selectedClipId === clip.id ? ' video-node--selected' : ''}${fromId === clip.id ? ' video-node--connecting' : ''}`}
            style={{ left: position.x, top: position.y }} aria-label={asset?.displayName ?? 'Missing media'}>
            <header onPointerDown={(event) => moveNode(event, clip.id, position)}>
              <span>{track.name} · {formatDuration(clipDurationMs(clip))}</span>
              <label onPointerDown={event => event.stopPropagation()}><input type="checkbox" aria-label={`Use source ${clip.id}`} checked={selectedSources.includes(clip.id)} disabled={locked}
                onChange={event => { const checked = event.currentTarget.checked; setSelectedSources(current => checked ? [...current, clip.id] : current.filter(id => id !== clip.id)); }} /> Use</label>
            </header>
            {track.kind === 'audio' && asset ? <AudioPicture projectId={project.id} asset={asset} /> : <button className="video-node__picture" type="button" onClick={() => {
              editor.setSelectedClipId(clip.id);
              editor.setSelectedAssetId(clip.assetId);
              editor.setPlayheadMs(clip.timelineStartMs);
              onPreview();
            }} aria-label={`Preview ${asset?.displayName ?? 'clip'}`}>
              {asset && <ClipPicture projectId={project.id} asset={asset} clip={clip} />}
            </button>}
            <strong>{asset?.displayName ?? 'Missing media'}</strong>
            <small>{formatDuration(clip.sourceStartMs)} – {formatDuration(clip.sourceEndMs)}</small>
            <div className="video-node__ports">
              <button type="button" disabled={locked || source === undefined || track.kind !== 'video'} onClick={() => chooseTarget(clip.id)}>● Input</button>
              <button type="button" disabled={locked} aria-pressed={fromId === clip.id} onClick={() => { setFromId(clip.id); setToId(null); setNotice('Choose a matching block input, or the next video clip’s input.'); }}>Output ●</button>
            </div>
          </article>)}
          {graph.blocks.map(block => {
            const result = evaluateCanvasBlock(project.timeline, graph, block.id);
            return <article key={block.id} data-block-id={block.id} aria-label={CANVAS_BLOCK_LABELS[block.kind]}
              className={`video-node video-function-node${fromId === block.id ? ' video-node--connecting' : ''}`}
              style={{ left: blockPosition(block).x, top: blockPosition(block).y }}>
              <header onPointerDown={event => moveNode(event, block.id, blockPosition(block))}>
                <strong>{CANVAS_BLOCK_LABELS[block.kind]}</strong>
                <button type="button" aria-label={`Remove ${CANVAS_BLOCK_LABELS[block.kind]} block`} disabled={locked}
                  onPointerDown={event => event.stopPropagation()} onClick={() => {
                    editor.updateCanvasGraph({ ...graph,
                      blocks: graph.blocks.filter(candidate => candidate.id !== block.id),
                      connections: graph.connections.filter(edge => edge.fromId !== block.id && edge.toId !== block.id)
                    });
                    if (fromId === block.id) setFromId(null);
                  }}>×</button>
              </header>
              <div className="video-function-node__output">
                <label><input type="checkbox" aria-label={`Select node ${block.id}`} checked={selectedBlocks.includes(block.id)} disabled={locked}
                  onChange={event => { const checked = event.currentTarget.checked; setSelectedBlocks(current => checked ? [...current, block.id] : current.filter(id => id !== block.id)); }} /> Select</label>
                <span>{canvasOutputType(project.timeline, graph, block.id)}</span>
                <button type="button" disabled={locked} aria-label={`Output from ${CANVAS_BLOCK_LABELS[block.kind]}`}
                  aria-pressed={fromId === block.id} onClick={() => { setFromId(block.id); setToId(null); setNotice('Select a matching input on another block.'); }}>Output ●</button>
              </div>
              <div className="video-function-node__inputs">
                {Array.from({ length: block.inputCount }, (_, input) => {
                  const edge = graph.connections.find(candidate => candidate.toId === block.id && candidate.input === input);
                  return <div key={input} className={`video-function-node__input video-function-node__input--${canvasInputType(block, input)}`}>
                    <button type="button" disabled={locked} aria-label={`Connect ${CANVAS_BLOCK_LABELS[block.kind]} ${inputLabel(block, input)}`}
                      onClick={() => connectBlock(block, input)}>● {inputLabel(block, input)}</button>
                    <select aria-label={`${block.id} input ${input + 1} source`} value={edge?.fromId ?? ''} disabled={locked} onChange={event => {
                      const action = event.currentTarget.value ? { action: 'canvas.connect', fromId: event.currentTarget.value, toId: block.id, input }
                        : { action: 'canvas.disconnect', id: block.id, input };
                      if (editor.applyEditingOperations([action])) setNotice('Input updated.');
                    }}>
                      <option value="">Choose {inputLabel(block, input)}</option>
                      {[...nodes.map(node => node.clip.id), ...graph.blocks.map(item => item.id)].filter(id => connectCanvasInput(project.timeline, graph, { fromId: id, toId: block.id, input }).success).map(id => <option key={id} value={id}>{sourceName(id)}</option>)}
                    </select>
                    {edge && <button type="button" disabled={locked} aria-label={`Disconnect ${CANVAS_BLOCK_LABELS[block.kind]} input ${input + 1}`}
                      onClick={() => editor.updateCanvasGraph({ ...graph, connections: graph.connections.filter(candidate => candidate !== edge) })}>×</button>}
                  </div>;
                })}
              </div>
              {canvasVariableInputs(block.kind) && <button className="video-function-node__add-input" type="button"
                disabled={locked || block.inputCount >= CANVAS_INPUT_LIMIT} onClick={() => editor.updateCanvasGraph({
                  ...graph, blocks: graph.blocks.map(candidate => candidate.id === block.id ? { ...candidate, inputCount: candidate.inputCount + 1 } : candidate)
                })}>+ Input</button>}
              <CanvasBlockSettings block={block} disabled={locked} onChange={settings => {
                if (editor.applyEditingOperations([{ action: 'canvas.configure', id: block.id, settings }])) setNotice('Block settings updated. Apply workflow to update the timeline.');
              }} />
              <div className="video-function-node__result">
                <span>{result.success ? formatDuration(result.output.durationMs) : result.error}</span>
                <button type="button" disabled={locked || !result.success} onClick={() => {
                  requestApply(block.id);
                }}>적용 영향 확인</button>
              </div>
            </article>;
          })}
          {nodes.length === 0 && graph.blocks.length === 0 && <div className="video-canvas__empty"><h2>Connect your footage</h2><p>Import media on the left. Add source clips and function blocks to build a workflow.</p></div>}
        </div>
      </div>
    </div>
    <div className="video-canvas__status" role="status">
      {source && target ? <>
        <span>Connect {source.asset?.displayName} → {target.asset?.displayName}. Close gaps and reorder this video track.</span>
        <button type="button" disabled={locked} onClick={() => {
          if (editor.connectVideoClips(source.clip.id, target.clip.id) !== null) { setFromId(null); setToId(null); setNotice('Connection applied. Save to keep this sequence.'); }
        }}>Apply connection</button>
      </> : <span>{notice || 'Add function blocks, then connect source outputs to matching inputs. Apply a block to edit the timeline.'}</span>}
      {fromId !== null && <button type="button" onClick={() => { setFromId(null); setToId(null); setNotice(''); }}>Cancel</button>}
    </div>
    </div>
  </section></NodeWorkflowImpactPanel>;
}
