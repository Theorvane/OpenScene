import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { MediaAsset, PersistedTimelineClip } from '../../../shared/timelineTypes';
import { clipDurationMs } from '../../../shared/timelineClipGeometry';
import { evaluateCanvasBlock } from '../../../shared/videoCanvasBlocks';
import {
  CANVAS_BLOCK_KINDS, CANVAS_BLOCK_LABELS, CANVAS_BLOCK_LIMIT, CANVAS_INPUT_LIMIT,
  EMPTY_CANVAS_GRAPH, canvasInputType, canvasOutputType, connectCanvasInput,
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
  const [assetId, setAssetId] = useState('');
  const [blockKind, setBlockKind] = useState<CanvasBlockKind>('video-sequence');
  const [notice, setNotice] = useState('');
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const graph = project.timeline.canvas ?? EMPTY_CANVAS_GRAPH;
  const tracks = project.timeline.tracks;
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
      position: positions[clip.id] ?? { x: 48 + column * 290, y: 48 + row * 260 }
    })));
  const source = nodes.find((node) => node.clip.id === fromId);
  const target = nodes.find((node) => node.clip.id === toId);
  const blockPosition = (block: CanvasBlock): CanvasPosition =>
    draggingBlockId === block.id ? positions[block.id] ?? block.position : block.position;
  const width = Math.max(1200, ...nodes.map(node => node.position.x + 320), ...graph.blocks.map(block => blockPosition(block).x + 360));
  const height = Math.max(500, ...nodes.map(node => node.position.y + 270), ...graph.blocks.map(block => blockPosition(block).y + 160 + block.inputCount * 42));

  const moveNode = (event: PointerEvent<HTMLElement>, id: string, initial: Position) => {
    if (event.button !== 0 || locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (graph.blocks.some(block => block.id === id)) setDraggingBlockId(id);
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

  const addBlock = () => {
    const position = { x: 48 + graph.blocks.length * 300, y: Math.min(20000, Math.max(48, ...nodes.map(node => node.position.y + 270))) };
    const block: CanvasBlock = { id: 'block-' + crypto.randomUUID(), kind: blockKind, inputCount: 2, position };
    if (editor.updateCanvasGraph({ ...graph, blocks: [...graph.blocks, block] }) !== null) {
      setNotice('Select a source output, then an input on the block.');
      requestAnimationFrame(() => viewport.current?.scrollTo({ left: position.x * zoom, top: position.y * zoom, behavior: 'smooth' }));
    }
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
    (canvasInputType(block, index) === 'video' ? 'Video' : 'Audio') + (block.kind === 'video-audio' ? '' : ' ' + (index + 1));
  const sourceName = (id: string) => {
    const block = graph.blocks.find(candidate => candidate.id === id);
    return nodes.find(node => node.clip.id === id)?.asset?.displayName ??
      (block === undefined ? 'Missing source' : CANVAS_BLOCK_LABELS[block.kind]);
  };

  return <section className="video-canvas" aria-label="Video connection canvas">
    <div className="video-canvas__toolbar">
      <strong>Canvas</strong>
      <select aria-label="Media to add to canvas" value={assetId} onChange={(event) => setAssetId(event.target.value)}>
        <option value="">Choose media</option>
        {project.assets.map((asset) =>
          <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}
      </select>
      <button type="button" disabled={!assetId || locked} onClick={() => editor.placeAssetOnTimeline(assetId)}>Add clip</button>
      <select aria-label="Function block" value={blockKind} onChange={event => setBlockKind(event.target.value as CanvasBlockKind)}>
        {CANVAS_BLOCK_KINDS.map(kind => <option key={kind} value={kind}>{CANVAS_BLOCK_LABELS[kind]}</option>)}
      </select>
      <button type="button" disabled={locked || graph.blocks.length >= CANVAS_BLOCK_LIMIT} onClick={addBlock}>Add block</button>
      <button type="button" disabled={locked || !editor.canUndoTimeline} onClick={() => {
        editor.undoTimeline(); setFromId(null); setToId(null); setNotice('Canvas edit undone.');
      }}>Undo</button>
      <button type="button" disabled={locked || !editor.canRedoTimeline} onClick={() => {
        editor.redoTimeline(); setFromId(null); setToId(null); setNotice('Canvas edit restored.');
      }}>Redo</button>
      <button type="button" aria-label="Zoom out canvas" onClick={() => setZoom(Math.max(.4, zoom - .1))}>−</button>
      <button type="button" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Zoom in canvas" onClick={() => setZoom(Math.min(1.8, zoom + .1))}>+</button>
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
            <header onPointerDown={(event) => moveNode(event, clip.id, position)}>{track.name} · {formatDuration(clipDurationMs(clip))}</header>
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
                    editor.updateCanvasGraph({
                      blocks: graph.blocks.filter(candidate => candidate.id !== block.id),
                      connections: graph.connections.filter(edge => edge.fromId !== block.id && edge.toId !== block.id)
                    });
                    if (fromId === block.id) setFromId(null);
                  }}>×</button>
              </header>
              <div className="video-function-node__output">
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
                    <span title={edge ? sourceName(edge.fromId) : ''}>{edge ? sourceName(edge.fromId) : 'Connect source'}</span>
                    {edge && <button type="button" disabled={locked} aria-label={`Disconnect ${CANVAS_BLOCK_LABELS[block.kind]} input ${input + 1}`}
                      onClick={() => editor.updateCanvasGraph({ ...graph, connections: graph.connections.filter(candidate => candidate !== edge) })}>×</button>}
                  </div>;
                })}
              </div>
              {block.kind !== 'video-audio' && <button className="video-function-node__add-input" type="button"
                disabled={locked || block.inputCount >= CANVAS_INPUT_LIMIT} onClick={() => editor.updateCanvasGraph({
                  ...graph, blocks: graph.blocks.map(candidate => candidate.id === block.id ? { ...candidate, inputCount: candidate.inputCount + 1 } : candidate)
                })}>+ Input</button>}
              <div className="video-function-node__result">
                <span>{result.success ? formatDuration(result.output.durationMs) : result.error}</span>
                <button type="button" disabled={locked || !result.success} onClick={() => {
                  if (editor.applyCanvasBlock(block.id)) {
                    setFromId(null); setToId(null);
                    setNotice('Block applied. Connected clips now start at the beginning of their output tracks. Use Undo to restore the previous edit.');
                  } else setNotice('The output could not be applied. Check the editor status.');
                }}>Apply block</button>
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
  </section>;
}
