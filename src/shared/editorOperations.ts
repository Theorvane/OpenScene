import { parseTimelineDocument } from './timelineDocumentValidators';
import { addTrack, removeTrack, renameTrack } from './timelineLogic';
import { deleteClip, moveClip, placeClip, splitClip, trimClipLeft, trimClipRight, updateClipEffects } from './timelineClipLogic';
import { clipDurationMs, clipTimelineEndMs } from './timelineClipGeometry';
import { updateAudioTrackMix, addClipKeyframe, removeClipKeyframe, updateClipKeyframe } from './timelineMetadataLogic';
import { addTitle, removeTitle, updateTitle } from './timelineTitleLogic';
import { applyCaptionPreset, applyTitleAppearanceToAutomaticCaptions, parseTimelineTitleStyle, resolvedTitleStyle, CAPTION_STYLE_PRESETS, type CaptionPresetId } from './captionStyle';
import { visualEffectValues, type VisualEffectPresetId } from './visualEffectPresets';
import { canvasDefaultInputCount } from './canvasBlockCatalog';
import { CANVAS_BLOCK_KINDS, CANVAS_BLOCK_LIMIT, EMPTY_CANVAS_GRAPH, canvasSourceTimeline, connectCanvasInput, type CanvasBlockKind } from './videoCanvasGraph';
import { applyCanvasBlock } from './videoCanvasBlocks';
import { createCanvasTemplate, CANVAS_TEMPLATES, type CanvasTemplateId } from './canvasTemplates';
import { cutNearest, removeTransitionAtCut, setTransitionAtCut } from './timelineTransitionLogic';
import { isPlainRecord, hasAllowedKeys } from './timelineValidationPrimitives';
import { CLIP_EFFECT_PROPERTIES, DEFAULT_CLIP_EFFECTS, type ClipKeyframe, type ClipEffectProperty, type MediaAsset, type TimelineDocument } from './timelineTypes';
import { STILL_DEFAULT_HOLD_MS } from './timelineStills';
import { DEFAULT_TITLE_SHADOW, TITLE_FONT_FAMILIES } from './titleTypography';
import { CANVAS_LAYOUT_MODES, layoutCanvas, type CanvasLayoutMode } from './canvasLayout';

export const EDITOR_OPERATION_FIELDS = {
  'canvas.add': ['id', 'kind', 'inputCount', 'x', 'y', 'settings'], 'canvas.configure': ['id', 'settings'],
  'canvas.connect': ['fromId', 'toId', 'input'], 'canvas.disconnect': ['id', 'input'], 'canvas.remove': ['id'],
  'canvas.inputs': ['id', 'inputCount'], 'canvas.move': ['id', 'x', 'y'], 'canvas.template': ['templateId', 'prefix', 'sourceIds'],
  'canvas.apply': ['id'], 'canvas.refreshSources': [],
  'canvas.layout': ['mode', 'ids'],
  'clip.add': ['id', 'assetId', 'trackId', 'startMs', 'sourceStartMs', 'sourceEndMs'],
  'clip.move': ['clipId', 'trackId', 'startMs'], 'clip.duplicate': ['clipId', 'id', 'trackId', 'startMs'], 'clip.delete': ['clipId'],
  'clip.split': ['clipId', 'id', 'atMs'], 'clip.trim': ['clipId', 'edge', 'atMs'], 'clip.effects': ['clipId', 'effects'], 'clip.look': ['clipId', 'preset', 'amount'],
  'clip.keyframe.add': ['clipId', 'keyframe'], 'clip.keyframe.update': ['clipId', 'property', 'atMs', 'keyframe'], 'clip.keyframe.remove': ['clipId', 'property', 'atMs'],
  'track.add': ['id', 'kind', 'name'], 'track.remove': ['trackId'], 'track.rename': ['trackId', 'name'], 'track.mix': ['trackId', 'mix'], 'track.reorder': ['trackIds'],
  'title.add': ['id', 'atMs', 'text', 'changes'], 'title.update': ['titleId', 'changes'], 'title.remove': ['titleId'], 'title.preset': ['titleId', 'preset'], 'title.applyCaptions': ['titleId'],
  'transition.set': ['atMs', 'type', 'durationMs'], 'transition.remove': ['atMs']
} as const;
export const EDITOR_OPERATION_NAMES = Object.keys(EDITOR_OPERATION_FIELDS) as (keyof typeof EDITOR_OPERATION_FIELDS)[];

function id(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new Error('Use an existing or unique opaque id (up to 128 characters).');
  return value;
}
function number(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('A finite numeric value is required.');
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error('An object is required.');
  return value;
}
function updateTitleChanges(timeline: TimelineDocument, titleId: string, raw: unknown): TimelineDocument | null {
  const title = timeline.titles?.find(title => title.id === titleId);
  if (!title) throw new Error('Choose an existing title.');
  const changes = record(raw);
  if (!hasAllowedKeys(changes, ['text', 'timelineStartMs', 'timelineEndMs', 'sizePx', 'color', 'positionX', 'positionY', 'style'])) throw new Error('Unknown title setting.');
  if (changes.style !== undefined) {
    const incoming = record(changes.style), previous = resolvedTitleStyle(title);
    const style = parseTimelineTitleStyle({ ...previous, ...incoming,
      ...(incoming.shadow === undefined ? {} : { shadow: { ...(previous.shadow ?? DEFAULT_TITLE_SHADOW), ...record(incoming.shadow) } }) });
    if (!style) throw new Error('Invalid typography settings.');
    return updateTitle(timeline, titleId, { ...changes, style });
  }
  return updateTitle(timeline, titleId, changes);
}

/** One atomic, bounded command surface for the UI and both agents. Nothing is persisted here. */
export function applyEditorOperations(timeline: TimelineDocument, operations: readonly unknown[], assets: readonly MediaAsset[] = []): { readonly success: true; readonly timeline: TimelineDocument; readonly outputIds: readonly string[] } | { readonly success: false; readonly error: string } {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 64) return { success: false, error: 'Use between 1 and 64 operations.' };
  let next = timeline;
  const outputIds: string[] = [];
  try {
    operations.forEach((raw, index) => {
      try {
        const op = record(raw), action = op.action as keyof typeof EDITOR_OPERATION_FIELDS;
        const allowed = EDITOR_OPERATION_FIELDS[action];
        if (!allowed || !hasAllowedKeys(op, ['action', ...allowed])) throw new Error('Unknown operation or unsupported fields.');
        const graph = next.canvas ?? EMPTY_CANVAS_GRAPH;
        let changed: TimelineDocument | null = null;
        const findClip = () => {
          for (const track of next.tracks) { const clip = track.clips.find(clip => clip.id === id(op.clipId)); if (clip) return { clip, track }; }
          throw new Error('Choose an existing timeline clip.');
        };
        switch (action) {
          case 'canvas.layout': {
            if (op.ids !== undefined && (!Array.isArray(op.ids) || op.ids.some(value => typeof value !== 'string'))) throw new Error('List existing node ids.');
            changed = { ...next, canvas: layoutCanvas(next, graph, op.mode as CanvasLayoutMode, op.ids as string[] | undefined) }; break;
          }
          case 'canvas.add': {
            const kind = op.kind as CanvasBlockKind, blockId = id(op.id);
            if (!CANVAS_BLOCK_KINDS.includes(kind) || graph.blocks.length >= CANVAS_BLOCK_LIMIT || graph.blocks.some(block => block.id === blockId) || canvasSourceTimeline(next, graph).tracks.some(track => track.clips.some(clip => clip.id === blockId))) throw new Error('Choose a supported block and a unique id, within the block limit.');
            changed = { ...next, canvas: { ...graph, blocks: [...graph.blocks, { id: blockId, kind, inputCount: number(op.inputCount, canvasDefaultInputCount(kind)), position: { x: number(op.x, 380), y: number(op.y, 48) }, ...(op.settings === undefined ? {} : { settings: record(op.settings) as Record<string, number | string> }) }] } };
            outputIds.push(blockId); break;
          }
          case 'canvas.configure': case 'canvas.move': case 'canvas.inputs': {
            const block = graph.blocks.find(block => block.id === id(op.id));
            if (!block) throw new Error('Choose an existing block.');
            const updated = action === 'canvas.configure' ? { ...block, settings: { ...block.settings, ...record(op.settings) } as Record<string, number | string> }
              : action === 'canvas.move' ? { ...block, position: { x: number(op.x), y: number(op.y) } } : { ...block, inputCount: number(op.inputCount) };
            changed = { ...next, canvas: { ...graph, blocks: graph.blocks.map(item => item.id === block.id ? updated : item), connections: graph.connections.filter(edge => edge.toId !== block.id || edge.input < updated.inputCount) } }; break;
          }
          case 'canvas.connect': {
            const result = connectCanvasInput(next, graph, { fromId: id(op.fromId), toId: id(op.toId), input: number(op.input) });
            if (!result.success) throw new Error(result.error);
            changed = { ...next, canvas: result.graph }; break;
          }
          case 'canvas.disconnect': case 'canvas.remove': {
            const blockId = id(op.id);
            const block = graph.blocks.find(block => block.id === blockId);
            if (!block) throw new Error('Choose an existing block.');
            const input = action === 'canvas.disconnect' ? number(op.input) : undefined;
            if (input !== undefined && (!Number.isInteger(input) || input < 0 || input >= block.inputCount)) {
              throw new Error('Choose an input on an existing block.');
            }
            changed = { ...next, canvas: { ...graph, blocks: action === 'canvas.remove' ? graph.blocks.filter(block => block.id !== blockId) : graph.blocks,
              connections: graph.connections.filter(edge => action === 'canvas.remove' ? edge.toId !== blockId && edge.fromId !== blockId : edge.toId !== blockId || edge.input !== input) } }; break;
          }
          case 'canvas.template': {
            if (op.sourceIds !== undefined && (!Array.isArray(op.sourceIds) || op.sourceIds.some(value => typeof value !== 'string'))) throw new Error('Source ids must be an array.');
            const prefix = id(op.prefix); if (prefix.length > 100) throw new Error('Use a workflow prefix of up to 100 characters.');
            const result = createCanvasTemplate(next, graph, op.templateId as CanvasTemplateId, prefix, op.sourceIds as string[] | undefined);
            changed = { ...next, canvas: result.graph }; outputIds.push(result.rootId); break;
          }
          case 'canvas.apply': {
            const result = applyCanvasBlock(next, graph, id(op.id)); if (!result.success) throw new Error(result.error); changed = result.timeline; break;
          }
          case 'canvas.refreshSources': { const { canvas: _canvas, ...sourceTimeline } = next; changed = { ...next, canvas: { ...graph, sourceTimeline } }; break; }
          case 'clip.delete': { const { clip } = findClip(); changed = deleteClip(next, clip.id); break; }
          case 'clip.move': changed = moveClip(next, { clipId: id(op.clipId), targetTrackId: id(op.trackId), timelineStartMs: number(op.startMs) }); break;
          case 'clip.split': changed = splitClip(next, { clipId: id(op.clipId), rightClipId: id(op.id), atMs: number(op.atMs) }); break;
          case 'clip.trim': {
            if (op.edge !== 'left' && op.edge !== 'right') throw new Error('Choose the left or right trim edge.');
            changed = op.edge === 'left' ? trimClipLeft(next, { clipId: id(op.clipId), timelineStartMs: number(op.atMs) }) : trimClipRight(next, { clipId: id(op.clipId), timelineEndMs: number(op.atMs) }); break;
          }
          case 'clip.effects': changed = updateClipEffects(next, { clipId: id(op.clipId), effects: record(op.effects) }); break;
          case 'clip.keyframe.add': case 'clip.keyframe.update': case 'clip.keyframe.remove': {
            const clipId = id(op.clipId);
            if (action !== 'clip.keyframe.add' && !CLIP_EFFECT_PROPERTIES.includes(op.property as ClipEffectProperty)) throw new Error('Choose a supported animated property.');
            if (action === 'clip.keyframe.remove') changed = removeClipKeyframe(next, { clipId, property: op.property as ClipEffectProperty, timelineTimeMs: number(op.atMs) });
            else {
              const keyframe = record(op.keyframe);
              if (!hasAllowedKeys(keyframe, ['timelineTimeMs', 'property', 'value', 'interpolation'])) throw new Error('Invalid keyframe fields.');
              changed = action === 'clip.keyframe.add' ? addClipKeyframe(next, { clipId, keyframe: keyframe as unknown as ClipKeyframe })
                : updateClipKeyframe(next, { clipId, property: op.property as ClipEffectProperty, timelineTimeMs: number(op.atMs), keyframe: keyframe as unknown as ClipKeyframe });
            } break;
          }
          case 'clip.look': changed = updateClipEffects(next, { clipId: id(op.clipId), effects: visualEffectValues(op.preset as VisualEffectPresetId, number(op.amount, 1)) }); break;
          case 'clip.duplicate': {
            const { clip, track } = findClip(), destination = next.tracks.find(candidate => candidate.id === (op.trackId ?? track.id));
            if (!destination || destination.kind !== track.kind) throw new Error('Choose a track with the same media type.');
            const startMs = number(op.startMs, Math.max(0, ...destination.clips.map(clipTimelineEndMs)));
            changed = placeClip(next, { trackId: destination.id, clip: { ...clip, id: id(op.id), timelineStartMs: startMs, keyframes: clip.keyframes.map(key => ({ ...key, timelineTimeMs: key.timelineTimeMs + startMs - clip.timelineStartMs })) } });
            outputIds.push(id(op.id)); break;
          }
          case 'clip.add': {
            const asset = assets.find(asset => asset.id === id(op.assetId));
            if (!asset) throw new Error('Choose an imported asset id.');
            const track = next.tracks.find(track => track.id === id(op.trackId));
            if (!track || track.kind !== (asset.kind === 'audio' ? 'audio' : 'video')) throw new Error('Choose a compatible track.');
            const duration = asset.kind === 'image' ? number(op.sourceEndMs, STILL_DEFAULT_HOLD_MS) : asset.metadata?.durationMs;
            if (!duration) throw new Error('Read the asset duration before placing it.');
            changed = placeClip(next, { trackId: track.id, clip: { id: id(op.id), assetId: asset.id, timelineStartMs: number(op.startMs, 0), sourceStartMs: number(op.sourceStartMs, 0), sourceEndMs: number(op.sourceEndMs, duration), sourceDurationMs: duration, effects: { ...DEFAULT_CLIP_EFFECTS }, keyframes: [] } });
            outputIds.push(id(op.id)); break;
          }
          case 'track.add': {
            if ((op.kind !== 'video' && op.kind !== 'audio') || typeof op.name !== 'string') throw new Error('Choose a video/audio track and a name.');
            changed = addTrack(next, { id: id(op.id), kind: op.kind, name: op.name }); break;
          }
          case 'track.remove': changed = removeTrack(next, id(op.trackId)); break;
          case 'track.rename': { if (typeof op.name !== 'string') throw new Error('A track name is required.'); changed = renameTrack(next, id(op.trackId), op.name); break; }
          case 'track.mix': changed = updateAudioTrackMix(next, { trackId: id(op.trackId), mix: record(op.mix) }); break;
          case 'track.reorder': {
            if (!Array.isArray(op.trackIds) || op.trackIds.length !== next.tracks.length || new Set(op.trackIds).size !== next.tracks.length || op.trackIds.some(value => !next.tracks.some(track => track.id === value))) throw new Error('List every track id exactly once.');
            changed = { ...next, tracks: op.trackIds.map(value => next.tracks.find(track => track.id === value)!) }; break;
          }
          case 'title.add': {
            if (typeof op.text !== 'string' || next.titles?.some(title => title.id === id(op.id))) throw new Error('Use title text and a unique title id.');
            const added = addTitle(next, { id: id(op.id), atMs: number(op.atMs), text: op.text });
            changed = op.changes === undefined ? added : updateTitleChanges(added, id(op.id), op.changes); outputIds.push(id(op.id)); break;
          }
          case 'title.update': changed = updateTitleChanges(next, id(op.titleId), op.changes); break;
          case 'title.remove': changed = removeTitle(next, id(op.titleId)); break;
          case 'title.preset': {
            const title = next.titles?.find(title => title.id === id(op.titleId));
            if (!title || !CAPTION_STYLE_PRESETS.some(preset => preset.id === op.preset)) throw new Error('Choose an existing title and style preset.');
            changed = updateTitle(next, title.id, applyCaptionPreset(title, op.preset as CaptionPresetId)); break;
          }
          case 'title.applyCaptions': changed = applyTitleAppearanceToAutomaticCaptions(next, id(op.titleId)); break;
          case 'transition.set': case 'transition.remove': {
            const cut = cutNearest(next, number(op.atMs), 500); if (!cut) throw new Error('Choose a cut between touching video clips.');
            if (action === 'transition.remove') changed = removeTransitionAtCut(next, cut);
            else {
              if (!['fade', 'crossfade', 'dipToBlack'].includes(op.type as string)) throw new Error('Choose a supported transition.');
              changed = setTransitionAtCut(next, cut, { type: op.type as 'fade' | 'crossfade' | 'dipToBlack', durationMs: number(op.durationMs, 400) });
            } break;
          }
        }
        const parsed = changed && parseTimelineDocument(changed);
        if (!parsed) throw new Error('This edit would violate media, timing or graph limits.');
        next = parsed;
      } catch (error: unknown) { throw new Error(`Operation ${index + 1}: ${error instanceof Error ? error.message : 'Invalid edit.'}`); }
    });
    return { success: true, timeline: next, outputIds };
  } catch (error: unknown) { return { success: false, error: error instanceof Error ? error.message : 'The edits could not be applied.' }; }
}

export function editingCapabilities() {
  return { operations: EDITOR_OPERATION_FIELDS, layouts: CANVAS_LAYOUT_MODES, templates: CANVAS_TEMPLATES, timeUnit: 'milliseconds', maximumOperations: 64,
    conventions: { ids: 'Opaque identifiers from the project; new IDs must be unique. Omit layout ids, or use an empty list, to arrange all nodes.',
      inputs: 'Zero-based port numbers. Template sourceIds preserves selection order. Apply a final block to update the timeline.',
      trim: 'clip.trim atMs is an absolute timeline edge. Canvas trim startMs/endMs is relative to its input; endMs=0 means input end.',
      sourceRanges: 'Canvas processing keeps original source ranges. Reapply safely; canvas.refreshSources deliberately takes current timeline edits as fresh input.',
      keyframes: 'keyframe={property,timelineTimeMs,value,interpolation}; interpolation is linear or hold. update/remove identify the old property and atMs.',
      titles: 'changes accepts text,timelineStartMs,timelineEndMs,sizePx,color,positionX,positionY,style. Partial style/shadow changes preserve other settings.' },
    clipEffectProperties: [...Object.keys(DEFAULT_CLIP_EFFECTS), 'speed'], animatedProperties: CLIP_EFFECT_PROPERTIES,
    titleFonts: TITLE_FONT_FAMILIES, captionPresets: CAPTION_STYLE_PRESETS, defaultShadow: DEFAULT_TITLE_SHADOW,
    examples: [{ action: 'canvas.add', id: 'trim-1', kind: 'trim', settings: { startMs: 1000, endMs: 3000 } }, { action: 'canvas.connect', fromId: 'existing-clip-id', toId: 'trim-1', input: 0 }, { action: 'canvas.apply', id: 'trim-1' },
      { action: 'title.update', titleId: 'existing-title-id', changes: { style: { fontFamily: 'korean', shadow: { color: '#000000', opacity: 0.7, offsetX: 4, offsetY: 4 } } } }] };
}
