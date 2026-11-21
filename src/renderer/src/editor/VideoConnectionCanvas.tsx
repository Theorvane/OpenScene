import { useState, type PointerEvent } from 'react';
import type { MediaAsset, PersistedTimelineClip } from '../../../shared/timelineTypes';
import { clipDurationMs } from '../../../shared/timelineClipGeometry';
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
  const [notice, setNotice] = useState('');
  const tracks = project.timeline.tracks.filter((track) => track.kind === 'video');
  const nodes = tracks.flatMap((track, row) => [...track.clips]
    .sort((left, right) => left.timelineStartMs - right.timelineStartMs)
    .map((clip, column) => ({
      clip, track, asset: project.assets.find((asset) => asset.id === clip.assetId),
      position: positions[clip.id] ?? { x: 48 + column * 290, y: 48 + row * 260 }
    })));
  const source = nodes.find((node) => node.clip.id === fromId);
  const target = nodes.find((node) => node.clip.id === toId);
  const width = Math.max(1200, ...nodes.map((node) => node.position.x + 320));
  const height = Math.max(500, ...nodes.map((node) => node.position.y + 270));

  const moveNode = (event: PointerEvent<HTMLElement>, id: string, initial: Position) => {
    if (event.button !== 0 || locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = { x: event.clientX, y: event.clientY };
    const element = event.currentTarget;
    const move = (next: globalThis.PointerEvent) => {
      const position = {
        x: Math.round(Math.min(20000, Math.max(0, initial.x + (next.clientX - origin.x) / zoom))),
        y: Math.round(Math.min(20000, Math.max(0, initial.y + (next.clientY - origin.y) / zoom)))
      };
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

  return <section className="video-canvas" aria-label="Video connection canvas">
    <div className="video-canvas__toolbar">
      <strong>Canvas</strong>
      <select aria-label="Media to add to canvas" value={assetId} onChange={(event) => setAssetId(event.target.value)}>
        <option value="">Choose media</option>
        {project.assets.filter((asset) => asset.kind !== 'audio').map((asset) =>
          <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}
      </select>
      <button type="button" disabled={!assetId || locked} onClick={() => editor.placeAssetOnTimeline(assetId)}>Add clip</button>
      <button type="button" aria-label="Zoom out canvas" onClick={() => setZoom(Math.max(.4, zoom - .1))}>−</button>
      <button type="button" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Zoom in canvas" onClick={() => setZoom(Math.min(1.8, zoom + .1))}>+</button>
    </div>
    <div className="video-canvas__scroll" tabIndex={0} aria-label="Scrollable canvas">
      <div style={{ width: width * zoom, height: height * zoom }}>
        <div className="video-canvas__plane" style={{ width, height, transform: `scale(${zoom})` }}>
          <svg className="video-canvas__wires" width={width} height={height} aria-hidden="true">
            {nodes.map((node, index) => {
              const next = nodes[index + 1];
              if (next === undefined || next.track.id !== node.track.id) return null;
              const startX = node.position.x + 240;
              const endX = next.position.x;
              return <path key={node.clip.id} d={`M ${startX} ${node.position.y + 105} C ${startX + 70} ${node.position.y + 105}, ${endX - 70} ${next.position.y + 105}, ${endX} ${next.position.y + 105}`} />;
            })}
          </svg>
          {nodes.map(({ clip, asset, track, position }) => <article key={clip.id}
            className={`video-node${editor.selectedClipId === clip.id ? ' video-node--selected' : ''}${fromId === clip.id ? ' video-node--connecting' : ''}`}
            style={{ left: position.x, top: position.y }} aria-label={asset?.displayName ?? 'Missing media'}>
            <header onPointerDown={(event) => moveNode(event, clip.id, position)}>{track.name} · {formatDuration(clipDurationMs(clip))}</header>
            <button className="video-node__picture" type="button" onClick={() => {
              editor.setSelectedClipId(clip.id);
              editor.setSelectedAssetId(clip.assetId);
              editor.setPlayheadMs(clip.timelineStartMs);
              onPreview();
            }} aria-label={`Preview ${asset?.displayName ?? 'clip'}`}>
              {asset && <ClipPicture projectId={project.id} asset={asset} clip={clip} />}
            </button>
            <strong>{asset?.displayName ?? 'Missing media'}</strong>
            <small>{formatDuration(clip.sourceStartMs)} – {formatDuration(clip.sourceEndMs)}</small>
            <div className="video-node__ports">
              <button type="button" disabled={locked || fromId === null} onClick={() => chooseTarget(clip.id)}>● Input</button>
              <button type="button" disabled={locked} aria-pressed={fromId === clip.id} onClick={() => { setFromId(clip.id); setToId(null); setNotice('Choose the input of the next clip.'); }}>Output ●</button>
            </div>
          </article>)}
          {nodes.length === 0 && <div className="video-canvas__empty"><h2>Connect your footage</h2><p>Import media on the left, then add a clip to start your sequence.</p></div>}
        </div>
      </div>
    </div>
    <div className="video-canvas__status" role="status">
      {source && target ? <>
        <span>Connect {source.asset?.displayName} → {target.asset?.displayName}. Close gaps and reorder this video track.</span>
        <button type="button" disabled={locked} onClick={() => {
          if (editor.connectVideoClips(source.clip.id, target.clip.id) !== null) { setFromId(null); setToId(null); setNotice('Connection applied. Save to keep this sequence.'); }
        }}>Apply connection</button>
      </> : <span>{notice || 'Drag cards to arrange. Select a card to preview. Connect Output to Input to change playback order.'}</span>}
      {fromId !== null && <button type="button" onClick={() => { setFromId(null); setToId(null); setNotice(''); }}>Cancel</button>}
    </div>
  </section>;
}
