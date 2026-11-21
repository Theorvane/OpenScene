import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import { CLIP_EFFECT_RANGES, DEFAULT_CLIP_EFFECTS, TRANSITION_TYPES } from '../../../shared/timelineTypes';
import type { TransitionType } from '../../../shared/timelineTypes';
import type { TimelineTitleStyle } from '../../../shared/timelineTypes';
import { applyCaptionPreset, CAPTION_FONT_WEIGHTS, CAPTION_PLACEMENTS, CAPTION_STYLE_PRESETS, isAutomaticCaptionId, resolvedTitleStyle, type CaptionPresetId } from '../../../shared/captionStyle';
import { clipDurationMs, clipTimelineEndMs } from '../../../shared/timelineClipGeometry';
import { STILL_DEFAULT_HOLD_MS } from '../../../shared/timelineStills';
import { formatDuration, formatTimestamp } from '../format';
import { Button, MetadataList, PanelHeading, TabPanel, Tabs } from '../ui';
import type { TabDefinition } from '../ui';
import {
  effectDbToVolume,
  effectPercentToOpacity,
  effectPercentToScale,
  effectUnitToPercent,
  effectVolumeToDb
} from './clipEffectControls';
import type { InspectorTabId } from './TimelineEditor';
import type { TimelineEditorController } from './useTimelineEditor';

type InspectorPanelProps = {
  readonly activeTabId: InspectorTabId;
  readonly editor: TimelineEditorController;
  readonly onActiveTabChange: (tabId: InspectorTabId) => void;
  readonly tabs: readonly TabDefinition<InspectorTabId>[];
};

type InspectorContentProps = {
  readonly editor: TimelineEditorController;
};

type PropertyGroupProps = {
  readonly title: string;
  readonly children: ReactNode;
  readonly defaultExpanded?: boolean;
  readonly onReset?: () => void;
};

/* Collapsible property group: hairline separators, xs medium title, −/+ toggle. */
function PropertyGroup({ title, children, defaultExpanded = true, onReset }: PropertyGroupProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="property-group">
      <div className="property-group__heading">
      <button
        className="property-group__header"
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((expanded) => !expanded)}
      >
        <span className={`property-group__title${isExpanded ? ' property-group__title--expanded' : ''}`}>{title}</span>
        <span aria-hidden="true" className="property-group__toggle">{isExpanded ? '−' : '+'}</span>
      </button>
      {onReset && <button type="button" className="property-group__reset" aria-label={`Reset ${title.toLowerCase()}`} onClick={onReset}>Reset</button>}
      </div>
      {isExpanded && <div className="property-group__body">{children}</div>}
    </div>
  );
}

function TimingInput({ label, valueMs, onCommit }: { readonly label: string; readonly valueMs: number; readonly onCommit: (ms: number) => void }): ReactElement {
  const [draft, setDraft] = useState((valueMs / 1000).toFixed(3));
  useEffect(() => setDraft((valueMs / 1000).toFixed(3)), [valueMs]);
  return <input type="number" className="property-number-input" aria-label={label} min={0} step={0.001} value={draft}
    onChange={event => setDraft(event.currentTarget.value)}
    onBlur={() => {
      const ms = Math.round(Number(draft) * 1000);
      if (draft.trim() && Number.isFinite(ms) && ms >= 0 && ms !== valueMs) onCommit(ms);
      setDraft((valueMs / 1000).toFixed(3));
    }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft((valueMs / 1000).toFixed(3)); } }} />;
}

type PropertyRowProps = {
  readonly label: string;
  readonly children: ReactNode;
};

/* Label/value property row: muted caption label left, value right. */
function PropertyRow({ label, children }: PropertyRowProps): ReactElement {
  return (
    <div className="property-row">
      <span className="property-row__label">{label}</span>
      <div className="property-row__value">{children}</div>
    </div>
  );
}

/*
  Transitions.

  Between two clips, so there is nothing to select and the playhead is the only
  thing that can point at one. Park it near a cut and these controls apply to
  that cut; away from every cut they say so rather than disappearing, because a
  control that vanishes reads as a broken build.
*/
const TRANSITION_LABELS: Readonly<Record<TransitionType, string>> = {
  fade: 'Fade',
  crossfade: 'Crossfade',
  dipToBlack: 'Dip to black'
};

function TransitionControls({ editor }: InspectorContentProps): ReactElement {
  const cut = editor.cutAtPlayhead;
  const transition = editor.transitionAtPlayhead;

  return (
    <PropertyGroup title="Transition">
      {cut === null ? (
        <div className="empty-slate">
          Move the playhead to a cut — where two clips touch — to put a transition on it.
        </div>
      ) : (
        <>
          <div className="inspector-action-grid" role="toolbar" aria-label="Transition controls">
            {TRANSITION_TYPES.map((type) => (
              <Button
                key={type}
                className="inspector-action"
                variant={transition?.type === type ? 'primary' : 'default'}
                onClick={() => editor.setTransitionAtPlayhead(type)}
              >
                {TRANSITION_LABELS[type]}
              </Button>
            ))}
            {transition !== null && (
              <Button className="inspector-action" variant="stop" onClick={editor.removeTransitionAtPlayhead}>
                Remove
              </Button>
            )}
          </div>

          <PropertyRow label="At"><span className="property-value-chip">{formatDuration(cut.cutMs)}</span></PropertyRow>

          {transition !== null && (
            <PropertyRow label="Length">
              <input
                className="property-number-input"
                type="number"
                aria-label="Transition length in milliseconds"
                value={transition.durationMs}
                min={100}
                step={100}
                onChange={(event) =>
                  editor.setTransitionAtPlayhead(transition.type, Number(event.currentTarget.value))
                }
              />
            </PropertyRow>
          )}
        </>
      )}
    </PropertyGroup>
  );
}

/*
  Titles.

  Addressed by the playhead rather than by selection, because a title is not a
  clip and there is nothing on the timeline to click. Park the playhead where
  the words should be, add one, and the group edits whichever title covers that
  moment — which is also the one the program monitor is drawing, so the numbers
  and the picture always describe each other.
*/
function TitleControls({ editor }: InspectorContentProps): ReactElement {
  const title = editor.titleAtPlayhead;
  const automaticCaptionCount = editor.project?.timeline.titles?.filter((entry) => isAutomaticCaptionId(entry.id)).length ?? 0;
  const style = title === null ? null : resolvedTitleStyle(title);

  return (
    <PropertyGroup title="Titles">
      <div className="inspector-action-grid" role="toolbar" aria-label="Title controls">
        <Button className="inspector-action" onClick={editor.addTitleAtPlayhead}>Add title</Button>
        {title !== null && (
          <Button className="inspector-action" variant="stop" onClick={() => editor.deleteTitle(title.id)}>
            Delete title
          </Button>
        )}
      </div>

      {title === null ? (
        <div className="empty-slate">No title at the playhead. Add one to caption this moment.</div>
      ) : (
        <>
          <PropertyRow label="Text">
            <input
              className="property-text-input"
              type="text"
              aria-label="Title text"
              value={title.text}
              onChange={(event) => editor.editTitle(title.id, { text: event.currentTarget.value })}
            />
          </PropertyRow>
          <PropertyRow label="Size">
            <input
              className="property-number-input"
              type="number"
              aria-label="Title size"
              value={title.sizePx}
              min={8}
              max={512}
              onChange={(event) => editor.editTitle(title.id, { sizePx: Number(event.currentTarget.value) })}
            />
          </PropertyRow>
          <PropertyRow label="Colour">
            <input
              className="property-color-input"
              type="color"
              aria-label="Title colour"
              value={title.color}
              onChange={(event) => editor.editTitle(title.id, { color: event.currentTarget.value })}
            />
          </PropertyRow>
          <PropertyRow label="Preset">
            <select
              className="property-text-input"
              aria-label="Caption style preset"
              value=""
              onChange={(event) => {
                const next = applyCaptionPreset(title, event.currentTarget.value as CaptionPresetId);
                editor.editTitle(title.id, {
                  sizePx: next.sizePx,
                  color: next.color,
                  positionX: next.positionX,
                  positionY: next.positionY,
                  ...(next.style === undefined ? {} : { style: next.style })
                });
              }}
            >
              <option value="" disabled>Choose preset…</option>
              {CAPTION_STYLE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            </select>
          </PropertyRow>
          {style !== null && (
            <>
              <PropertyRow label="Anchor">
                <select
                  className="property-text-input"
                  aria-label="Title safe-area anchor"
                  value={style.placement}
                  onChange={(event) => editor.editTitle(title.id, { style: { ...style, placement: event.currentTarget.value as TimelineTitleStyle['placement'] } })}
                >
                  {CAPTION_PLACEMENTS.map((placement) => <option key={placement} value={placement}>{placement[0]?.toUpperCase()}{placement.slice(1)}</option>)}
                </select>
              </PropertyRow>
              <PropertyRow label="Weight">
                <select
                  className="property-text-input"
                  aria-label="Title font weight"
                  value={style.fontWeight}
                  onChange={(event) => editor.editTitle(title.id, { style: { ...style, fontWeight: event.currentTarget.value as TimelineTitleStyle['fontWeight'] } })}
                >
                  {CAPTION_FONT_WEIGHTS.map((weight) => <option key={weight} value={weight}>{weight[0]?.toUpperCase()}{weight.slice(1)}</option>)}
                </select>
              </PropertyRow>
              <PropertyRow label="Outline">
                <input className="property-color-input" type="color" aria-label="Title outline colour" value={style.outlineColor}
                  onChange={(event) => editor.editTitle(title.id, { style: { ...style, outlineColor: event.currentTarget.value } })} />
                <input className="property-number-input" type="number" aria-label="Title outline width" min={0} max={24} step={1} value={style.outlineWidthPx}
                  onChange={(event) => editor.editTitle(title.id, { style: { ...style, outlineWidthPx: Number(event.currentTarget.value) } })} />
              </PropertyRow>
              <PropertyRow label="Background">
                <input className="property-color-input" type="color" aria-label="Title background colour" value={style.backgroundColor}
                  onChange={(event) => editor.editTitle(title.id, { style: { ...style, backgroundColor: event.currentTarget.value } })} />
                <input className="property-number-input" type="number" aria-label="Title background opacity" min={0} max={1} step={0.05} value={style.backgroundOpacity}
                  onChange={(event) => editor.editTitle(title.id, { style: { ...style, backgroundOpacity: Number(event.currentTarget.value) } })} />
              </PropertyRow>
              <PropertyRow label="Padding">
                <input className="property-number-input" type="number" aria-label="Title background padding" min={0} max={64} step={1} value={style.paddingPx}
                  onChange={(event) => editor.editTitle(title.id, { style: { ...style, paddingPx: Number(event.currentTarget.value) } })} />
              </PropertyRow>
            </>
          )}
          <PropertyRow label="Position">
            <span className="property-axis-label" aria-hidden="true">X</span>
            <input
              className="property-number-input"
              type="number"
              aria-label="Title position X"
              value={title.positionX}
              onChange={(event) => editor.editTitle(title.id, { positionX: Number(event.currentTarget.value) })}
            />
            <span className="property-axis-label" aria-hidden="true">Y</span>
            <input
              className="property-number-input"
              type="number"
              aria-label="Title position Y"
              value={title.positionY}
              onChange={(event) => editor.editTitle(title.id, { positionY: Number(event.currentTarget.value) })}
            />
          </PropertyRow>
          <PropertyRow label="Start">
            <span className="property-value-chip">{formatDuration(title.timelineStartMs)}</span>
          </PropertyRow>
          <PropertyRow label="End">
            <span className="property-value-chip">{formatDuration(title.timelineEndMs)}</span>
          </PropertyRow>
          <div className="inspector-action-grid" role="toolbar" aria-label="Title timing controls">
            <Button
              className="inspector-action"
              onClick={() => editor.editTitle(title.id, { timelineEndMs: title.timelineEndMs - 500 })}
            >
              Shorten -0.5s
            </Button>
            <Button
              className="inspector-action"
              onClick={() => editor.editTitle(title.id, { timelineEndMs: title.timelineEndMs + 500 })}
            >
              Lengthen +0.5s
            </Button>
          </div>
          <Button
            className="inspector-action caption-style-apply"
            disabled={automaticCaptionCount === 0}
            onClick={() => editor.applyTitleStyleToAutomaticCaptions(title.id)}
          >
            Apply appearance to {automaticCaptionCount} automatic caption{automaticCaptionCount === 1 ? '' : 's'}
          </Button>
          <p className="caption-style-note">Top, center and bottom anchors stay inside the title-safe region when the export aspect ratio changes. X/Y remain fine-tuning offsets.</p>
        </>
      )}
    </PropertyGroup>
  );
}

function SelectionInspector({ editor }: InspectorContentProps): ReactElement {
  const [section, setSection] = useState<'edit' | 'video' | 'audio' | 'text'>('edit');
  const clip = editor.selectedClip;
  const effects = clip?.clip.effects ?? DEFAULT_CLIP_EFFECTS;
  const opacityPercent = effectUnitToPercent(effects.opacity);
  const scalePercent = effectUnitToPercent(effects.scale);
  const volumeDb = effectVolumeToDb(effects.volume);
  const canCut = clip !== null && editor.playheadMs > clip.clip.timelineStartMs && editor.playheadMs < clipTimelineEndMs(clip.clip);
  useEffect(() => {
    if ((section === 'video' && clip?.asset?.kind === 'audio') || (section === 'audio' && clip?.asset?.kind === 'image')) setSection('edit');
  }, [clip?.asset?.kind, section]);

  return (
    <section className="clip-controls inspector-section" aria-label="Selected clip controls">
      <h3 className="inspector-section__title">
        {clip === null ? 'No clip selected' : clip.asset?.displayName ?? 'Missing asset'}
      </h3>
      <div className="inspector-categories" role="group" aria-label="Clip editing categories">
        {(['edit', 'video', 'audio', 'text'] as const).map(id => <button key={id} type="button" aria-pressed={section === id}
          disabled={(id === 'video' && clip?.asset?.kind === 'audio') || (id === 'audio' && clip?.asset?.kind === 'image')}
          onClick={() => setSection(id)}>{({ edit: 'Edit', video: 'Video', audio: 'Audio', text: 'Text' })[id]}</button>)}
      </div>

      {editor.project === null ? (
        <div className="empty-slate">Create or open a project before editing clips.</div>
      ) : clip === null ? (
        <div className="empty-slate">Select a clip on the timeline to edit its timing, picture and sound.</div>
      ) : (
        <>
          <div className="inspector-selection-summary"><span>{clip.asset?.kind ?? 'Clip'} · {clip.track.name}</span><strong>{formatDuration(clipDurationMs(clip.clip))}</strong></div>
          <fieldset className="inspector-fields" disabled={editor.isBusy}>
          <div hidden={section !== 'edit'}>
          <PropertyGroup title="Cut & trim">
            <p className="inspector-help">Cuts use the playhead position. Move it inside the selected clip.</p>
            <div className="inspector-action-grid" role="toolbar" aria-label="Selected clip trim controls">
              <Button className="inspector-action inspector-action--wide" disabled={!canCut} onClick={editor.splitAtPlayhead}>Split at playhead</Button>
              <Button className="inspector-action" disabled={!canCut} onClick={() => editor.trimClipTo(clip.clip.id, 'left', editor.playheadMs)}>Trim start here</Button>
              <Button className="inspector-action" disabled={!canCut} onClick={() => editor.trimClipTo(clip.clip.id, 'right', editor.playheadMs)}>Trim end here</Button>
              <Button className="inspector-action" onClick={editor.duplicateSelectedClip}>Duplicate clip</Button>
              <Button className="inspector-action" variant="stop" onClick={editor.deleteSelectedClip}>Delete selection</Button>
            </div>
          </PropertyGroup>

          <PropertyGroup title="Timing">
            <PropertyRow label="Start (s)"><TimingInput label="Clip timeline start in seconds" valueMs={clip.clip.timelineStartMs} onCommit={ms => editor.moveSelectedClip(ms - clip.clip.timelineStartMs)} /></PropertyRow>
            <PropertyRow label="End (s)"><TimingInput label="Clip timeline end in seconds" valueMs={clipTimelineEndMs(clip.clip)} onCommit={ms => editor.trimClipTo(clip.clip.id, 'right', ms)} /></PropertyRow>
            <MetadataList
              className="editor-meta"
              items={[
                { term: 'Source in', description: formatDuration(clip.clip.sourceStartMs) },
                { term: 'Source out', description: formatDuration(clip.clip.sourceEndMs) }
              ]}
            />
          </PropertyGroup>

          {/*
            Speed sits with timing rather than with the transform: it is the one
            control here that changes how much room the clip takes, and putting
            it beside opacity would suggest otherwise.
          */}
          <PropertyGroup title="Speed" onReset={() => editor.updateSelectedClipEffects({ speed: 1 })}>
            <PropertyRow label="Rate">
              <input
                className="property-number-input"
                type="number"
                aria-label="Clip speed"
                value={effects.speed ?? 1}
                min={CLIP_EFFECT_RANGES.speed.min}
                max={CLIP_EFFECT_RANGES.speed.max}
                step={0.25}
                onChange={(event) => editor.updateSelectedClipEffects({ speed: Number(event.currentTarget.value) })}
              />
            </PropertyRow>
            <PropertyRow label="Length">
              <span className="property-value-chip">{formatDuration(clipDurationMs(clip.clip))}</span>
            </PropertyRow>
          </PropertyGroup>
          <TransitionControls editor={editor} />
          </div>
          <div hidden={section !== 'video'}>

          <PropertyGroup title="Colour" onReset={() => editor.updateSelectedClipEffects({ brightness: 0, contrast: 1, saturation: 1 })}>
            <PropertyRow label="Brightness">
              <input
                className="property-slider"
                type="range"
                aria-label="Clip brightness"
                value={effects.brightness ?? 0}
                min={CLIP_EFFECT_RANGES.brightness.min}
                max={CLIP_EFFECT_RANGES.brightness.max}
                step={0.05}
                onChange={(event) => editor.updateSelectedClipEffects({ brightness: Number(event.currentTarget.value) })}
              />
              <span className="property-value-chip">{(effects.brightness ?? 0).toFixed(2)}</span>
            </PropertyRow>
            <PropertyRow label="Contrast">
              <input
                className="property-slider"
                type="range"
                aria-label="Clip contrast"
                value={effects.contrast ?? 1}
                min={CLIP_EFFECT_RANGES.contrast.min}
                max={CLIP_EFFECT_RANGES.contrast.max}
                step={0.05}
                onChange={(event) => editor.updateSelectedClipEffects({ contrast: Number(event.currentTarget.value) })}
              />
              <span className="property-value-chip">{(effects.contrast ?? 1).toFixed(2)}</span>
            </PropertyRow>
            <PropertyRow label="Saturation">
              <input
                className="property-slider"
                type="range"
                aria-label="Clip saturation"
                value={effects.saturation ?? 1}
                min={CLIP_EFFECT_RANGES.saturation.min}
                max={CLIP_EFFECT_RANGES.saturation.max}
                step={0.05}
                onChange={(event) => editor.updateSelectedClipEffects({ saturation: Number(event.currentTarget.value) })}
              />
              <span className="property-value-chip">{(effects.saturation ?? 1).toFixed(2)}</span>
            </PropertyRow>
          </PropertyGroup>

          <PropertyGroup title="Transform" onReset={() => editor.updateSelectedClipEffects({ positionX: 0, positionY: 0, scale: 1, rotation: 0 })}>
            <PropertyRow label="Position">
              <span className="property-axis-label" aria-hidden="true">X</span>
              <input
                className="property-number-input"
                type="number"
                aria-label="Clip effect position X"
                value={effects.positionX}
                min={CLIP_EFFECT_RANGES.positionX.min}
                max={CLIP_EFFECT_RANGES.positionX.max}
                onChange={(event) => editor.updateSelectedClipEffects({ positionX: Number(event.currentTarget.value) })}
              />
              <span className="property-axis-label" aria-hidden="true">Y</span>
              <input
                className="property-number-input"
                type="number"
                aria-label="Clip effect position Y"
                value={effects.positionY}
                min={CLIP_EFFECT_RANGES.positionY.min}
                max={CLIP_EFFECT_RANGES.positionY.max}
                onChange={(event) => editor.updateSelectedClipEffects({ positionY: Number(event.currentTarget.value) })}
              />
            </PropertyRow>
            <PropertyRow label="Scale">
              <input
                className="property-slider"
                type="range"
                aria-label="Clip effect scale"
                min={CLIP_EFFECT_RANGES.scale.min * 100}
                max={CLIP_EFFECT_RANGES.scale.max * 100}
                value={scalePercent}
                onChange={(event) => editor.updateSelectedClipEffects({ scale: effectPercentToScale(Number(event.currentTarget.value)) })}
              />
              <span className="property-value-chip">{scalePercent}%</span>
            </PropertyRow>
            <PropertyRow label="Rotation">
              <input
                className="property-slider"
                type="range"
                aria-label="Clip effect rotation"
                min="0"
                max="360"
                value={effects.rotation}
                onChange={(event) => editor.updateSelectedClipEffects({ rotation: Number(event.currentTarget.value) })}
              />
              <span className="property-dial" aria-hidden="true" title="Rotation Angle Indicator">
                <span className="property-dial__needle" style={{ transform: `translate(-50%, -100%) rotate(${effects.rotation}deg)` }} />
              </span>
              <span className="property-value-chip">{effects.rotation}°</span>
            </PropertyRow>
          </PropertyGroup>

          <PropertyGroup title="Opacity" onReset={() => editor.updateSelectedClipEffects({ opacity: 1 })}>
            <PropertyRow label="Opacity">
              <input
                className="property-slider"
                type="range"
                aria-label="Clip effect opacity"
                min={CLIP_EFFECT_RANGES.opacity.min * 100}
                max={CLIP_EFFECT_RANGES.opacity.max * 100}
                value={opacityPercent}
                onChange={(event) => editor.updateSelectedClipEffects({ opacity: effectPercentToOpacity(Number(event.currentTarget.value)) })}
              />
              <span className="property-value-chip">{opacityPercent}%</span>
            </PropertyRow>
          </PropertyGroup>
          </div>
          <div hidden={section !== 'audio'}>

          <PropertyGroup title="Audio" onReset={() => editor.updateSelectedClipEffects({ volume: 1 })}>
            <PropertyRow label="Volume">
              <input
                className="property-slider"
                type="range"
                aria-label="Clip effect volume"
                min={CLIP_EFFECT_RANGES.volumeDb.min}
                max={CLIP_EFFECT_RANGES.volumeDb.max}
                value={volumeDb}
                onChange={(event) => editor.updateSelectedClipEffects({ volume: effectDbToVolume(Number(event.currentTarget.value)) })}
              />
              <span className="property-value-chip">{volumeDb} dB</span>
            </PropertyRow>
            {clip.asset?.kind === 'video' && (
              <PropertyRow label="Embedded">
                <Button
                  className="inspector-action"
                  disabled={editor.isBusy}
                  title="Extract the native sound, align it on an audio track, and mute this video clip"
                  onClick={() => void editor.detachSelectedClipAudio()}
                >
                  {editor.isBusy ? 'Extracting…' : 'Detach audio'}
                </Button>
              </PropertyRow>
            )}
          </PropertyGroup>
          </div>
          </fieldset>
        </>
      )}

      {editor.project !== null && <div hidden={section !== 'text'}><TitleControls editor={editor} /></div>}

      {editor.activePlaybackClip !== null && section === 'edit' && (
        <PropertyGroup title="Playback">
          <PropertyRow label="Playhead"><span className="property-value-chip">{formatDuration(editor.playheadMs)}</span></PropertyRow>
          <PropertyRow label="Source time"><span className="property-value-chip">{formatDuration(editor.activePlaybackClip.sourceTimeMs)}</span></PropertyRow>
        </PropertyGroup>
      )}
    </section>
  );
}

function AssetInspector({ editor }: InspectorContentProps): ReactElement {
  const asset = editor.selectedAsset;

  if (editor.project === null) {
    return <div className="empty-slate">Create or open a project before inspecting asset metadata.</div>;
  }

  if (asset === null) {
    return <div className="empty-slate">Select an imported asset to inspect its local metadata.</div>;
  }

  return (
    <section className="clip-controls inspector-section" aria-label="Selected asset metadata">
      <h3 className="inspector-section__title">{asset.displayName}</h3>
      <PropertyGroup title="Details">
        <PropertyRow label="Imported"><span className="property-value-chip">{formatTimestamp(asset.createdAt)}</span></PropertyRow>
        <PropertyRow label="Kind"><span className="property-value-chip property-value-chip--capitalize">{asset.kind}</span></PropertyRow>
        <PropertyRow label={asset.kind === 'image' ? 'Default hold' : 'Duration'}>
          <span className="property-value-chip">
            {asset.kind === 'image' ? formatDuration(STILL_DEFAULT_HOLD_MS) : asset.metadata === null ? 'Pending' : formatDuration(asset.metadata.durationMs)}
          </span>
        </PropertyRow>
      </PropertyGroup>
    </section>
  );
}

export function InspectorPanel({ activeTabId, editor, onActiveTabChange, tabs }: InspectorPanelProps): ReactElement {
  return (
    <aside className="inspector-panel" aria-labelledby="inspector-title">
      <PanelHeading>
        <h2 id="inspector-title" className="inspector-panel__title">Properties</h2>
      </PanelHeading>

      <Tabs activeTabId={activeTabId} idBase="inspector" tabs={tabs} onActiveTabChange={onActiveTabChange} aria-label="Inspector sections" />

      <div className="inspector-panel__content">
        <TabPanel activeTabId={activeTabId} idBase="inspector" tabId="selection">
          <SelectionInspector editor={editor} />
        </TabPanel>

        <TabPanel activeTabId={activeTabId} idBase="inspector" tabId="asset">
          <AssetInspector editor={editor} />
        </TabPanel>

      </div>
    </aside>
  );
}
