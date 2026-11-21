import { getMcpServerDefinition, McpResource, McpServer, McpTool } from '@theorvane/type-mcp';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve as resolvePath, sep } from 'node:path';
import { z } from 'zod';
import { METADATA_PRIVACY_MODES, type MetadataPrivacyMode } from '../shared/metadataPrivacy';
import { clipDurationMs, clipTimelineEndMs } from '../shared/timelineClipGeometry';
import { updateClipEffects as applyClipEffects, deleteClip, placeClip, splitClip } from '../shared/timelineClipLogic';
import { resolveTimelineTrackForAsset, trackAppendStartMs } from '../shared/timelineClipPlacement';
import { isValidClipEffects } from '../shared/timelineEffects';
import { addTitle, removeTitle, updateTitle } from '../shared/timelineTitleLogic';
import { cutNearest, removeTransitionAtCut, setTransitionAtCut } from '../shared/timelineTransitionLogic';
import { CLIP_EFFECT_RANGES, DEFAULT_CLIP_EFFECTS, type ClipEffects, type TimelineTrack } from '../shared/timelineTypes';
import { connectVideoClips } from '../shared/videoCanvas';
import { resolveVideoInspectionRange, sampleVideoInspectionSeconds } from '../shared/videoInspectionRange';
import type { ExportIpcService } from './exportIpcService';
import { discoverFfmpeg } from './ffmpegDiscovery';
import type { ProjectStore } from './projectStore';
import type { TranscriptionService } from './transcriptionService';
import {
  extractVideoFrames,
  formatFrameTimestamp,
  planFrameTimestamps,
  WATCH_FRAME_HARD_CAP,
  type ExtractedFrame
} from './videoFrameAnalysis';
// Aliased because the tool below carries the same name: the tool is the seam,
// the rule is what it calls.

/** Clip length used only when an asset has no probed duration yet. */
const FALLBACK_CLIP_DURATION_MS = 5_000;

/** Injectable frame extractor so tests never need a real FFmpeg runtime. */
export type WatchFrameExtractor = (input: {
  readonly filePath: string;
  readonly projectDirectory?: string;
  readonly timestampsMs: readonly number[];
}) => Promise<readonly ExtractedFrame[]>;

async function defaultWatchFrameExtractor(input: {
  readonly filePath: string;
  readonly projectDirectory?: string;
  readonly timestampsMs: readonly number[];
}): Promise<readonly ExtractedFrame[]> {
  const ffmpeg = await discoverFfmpeg();
  if (ffmpeg.kind === 'unavailable') {
    throw new Error(`FFmpeg is unavailable: ${ffmpeg.reason}`);
  }
  const filePath = await realpath(input.filePath);
  if (input.projectDirectory !== undefined && !filePath.startsWith(`${await realpath(input.projectDirectory)}${sep}`)) {
    throw new Error('The media file escapes the project directory.');
  }
  return extractVideoFrames({ ffmpegPath: ffmpeg.executablePath, filePath, timestampsMs: input.timestampsMs });
}

@McpServer({ name: 'openvideo-mcp-server', version: '0.1.0' })
export class OpenVideoMcpServer {
  private projectStore: ProjectStore | undefined;
  private exportIpcService: ExportIpcService | undefined;
  private watchFrameExtractor: WatchFrameExtractor = defaultWatchFrameExtractor;
  private transcriptionService: TranscriptionService | undefined;
  private notifyProjectTimelineChanged: ((projectId: string) => void) | undefined;

  /**
   * Agent tools write straight to the project store, so an editor that already
   * has the project open would keep showing — and later save over — its stale
   * copy. The host passes a notifier that tells open windows to reload.
   */
  public setProjectTimelineChangeNotifier(notify: (projectId: string) => void): void {
    this.notifyProjectTimelineChanged = notify;
  }

  public setServices(
    projectStore?: ProjectStore | undefined,
    exportIpcService?: ExportIpcService | undefined,
    watchFrameExtractor?: WatchFrameExtractor | undefined
  ): void {
    this.projectStore = projectStore;
    this.exportIpcService = exportIpcService;
    this.watchFrameExtractor = watchFrameExtractor ?? defaultWatchFrameExtractor;
  }

  public setTranscriptionService(service: TranscriptionService): void {
    this.transcriptionService = service;
  }

  @McpTool({
    description: 'Inspect an OpenScene project timeline and safe asset metadata for edit planning. This is read-only and never returns filesystem paths or credentials.',
    input: z.object({
      projectId: z.string().min(1)
    })
  })
  async getProjectTimeline(params: { projectId: string }) {
    if (!this.projectStore) {
      return { success: false, error: 'ProjectStore service is not available.' };
    }

    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) {
        return { success: false, error: `Project ${params.projectId} not found.` };
      }

      return {
        success: true,
        project: {
          id: project.id,
          name: project.name,
          assets: project.assets.map((asset) => ({
            id: asset.id,
            displayName: asset.displayName,
            kind: asset.kind,
            mimeType: asset.mimeType,
            durationMs: asset.metadata?.durationMs
          })),
          timeline: {
            tracks: project.timeline.tracks.map((track) => ({
              id: track.id,
              kind: track.kind,
              clips: track.clips.map((clip) => ({
                id: clip.id,
                assetId: clip.assetId,
                timelineStartMs: clip.timelineStartMs,
                sourceStartMs: clip.sourceStartMs,
                sourceEndMs: clip.sourceEndMs,
                /*
                  How long it actually occupies, which stopped being the source
                  window when clips gained a speed — and the effects themselves,
                  because an agent asked to slow a clip down cannot tell whether
                  it already is.
                */
                timelineEndMs: clipTimelineEndMs(clip),
                effects: clip.effects ?? DEFAULT_CLIP_EFFECTS
              }))
            })),
            // Both were invisible: an agent asked about a caption could not tell
            // one existed, let alone edit it.
            titles: project.timeline.titles ?? [],
            transitions: project.timeline.transitions
          }
        }
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : `Failed to inspect project ${params.projectId}`
      };
    }
  }

  @McpTool({
    description:
      'Watch a project video asset: samples a small set of frames across the video (or a focused startMs–endMs section) ' +
      'so the model can see what is on screen. Read-only. The frames are attached to the conversation as images with ' +
      'timestamps. Set perSecond with startMs/endMs for one frame per second in a window of up to 20 seconds. ' +
      'Read visible text from the images when relevant. Use a vision-capable model.',
    input: z.object({
      projectId: z.string().min(1),
      assetId: z.string().min(1),
      startMs: z.number().finite().min(0).optional(),
      endMs: z.number().finite().min(0).optional(),
      maxFrames: z.number().int().min(1).max(WATCH_FRAME_HARD_CAP).optional(),
      perSecond: z.boolean().optional()
    })
  })
  async watchProjectVideo(params: {
    projectId: string;
    assetId: string;
    startMs?: number;
    endMs?: number;
    maxFrames?: number;
    perSecond?: boolean;
  }) {
    if (!this.projectStore) {
      return { success: false as const, error: 'ProjectStore service is not available.' };
    }

    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) {
        return { success: false as const, error: `Project ${params.projectId} not found.` };
      }
      const asset = project.assets.find((candidate) => candidate.id === params.assetId);
      if (!asset) {
        return { success: false as const, error: `Asset ${params.assetId} not found in project ${params.projectId}.` };
      }
      if (asset.kind !== 'video') {
        return { success: false as const, error: `Asset ${params.assetId} is ${asset.kind}, not video.` };
      }
      const durationMs = asset.metadata?.durationMs;
      if (durationMs === undefined || durationMs <= 0) {
        return { success: false as const, error: 'The asset has no duration metadata yet; open it in the editor to probe it first.' };
      }

      const startMs = params.startMs ?? 0;
      const endMs = params.maxFrames === undefined
        ? params.endMs
        : Math.min(params.endMs ?? durationMs, startMs + params.maxFrames * 1000);
      const range = params.perSecond ? resolveVideoInspectionRange(durationMs, startMs, endMs) : null;
      const timestampsMs = params.perSecond ? (range === null ? [] : sampleVideoInspectionSeconds(range)) : planFrameTimestamps({
        durationMs,
        startMs: params.startMs,
        endMs: params.endMs,
        maxFrames: params.maxFrames
      });
      if (timestampsMs.length === 0) {
        return { success: false as const, error: 'The requested range contains nothing to sample.' };
      }

      // Confinement: the asset file must stay inside its resolved project folder.
      const projectDirectory = await this.projectStore.resolveDirectory(params.projectId);
      const filePath = resolvePath(projectDirectory, asset.projectRelativePath);
      if (!filePath.startsWith(`${projectDirectory}${sep}`)) {
        return { success: false as const, error: 'The asset path escapes the project folder and was refused.' };
      }

      let frames: readonly ExtractedFrame[];
      try {
        frames = await this.watchFrameExtractor({ filePath, timestampsMs, projectDirectory });
      } catch {
        // Extraction errors can carry filesystem paths in FFmpeg stderr; keep the tool result path-free.
        return { success: false as const, error: 'FFmpeg could not extract frames from this asset. Check FFmpeg readiness in Settings → Local Tools.' };
      }
      if (frames.length === 0) {
        return { success: false as const, error: 'FFmpeg produced no frames for the requested range.' };
      }

      return {
        success: true as const,
        projectId: params.projectId,
        assetId: asset.id,
        displayName: asset.displayName,
        durationMs,
        ...(range === null ? {} : range),
        frameCount: frames.length,
        summary:
          `Sampled ${frames.length} frames from "${asset.displayName}" at ` +
          `${frames.map((frame) => formatFrameTimestamp(frame.timeMs)).join(', ')}. ` +
          'The frames are attached to the conversation as images in chronological order.' +
          (range === null ? '' : ` Inspected ${range.startMs}–${range.endMs} ms of ${durationMs} ms.`),
        frames: frames.map((frame) => ({
          timeMs: frame.timeMs,
          timestamp: formatFrameTimestamp(frame.timeMs),
          jpegBase64: frame.jpegBase64
        }))
      };
    } catch (err) {
      return {
        success: false as const,
        error: err instanceof Error ? err.message : `Failed to watch asset ${params.assetId}.`
      };
    }
  }

  @McpTool({
    description: 'Extract spoken words with source timecodes from a project video window of up to 20 seconds. ' +
      'Uses local FFmpeg and whisper.cpp. The transcript is sent to the selected chat model after user approval.',
    input: z.object({
      projectId: z.string().min(1),
      assetId: z.string().min(1),
      startMs: z.number().int().min(0),
      endMs: z.number().int().min(0).optional()
    })
  })
  async transcribeProjectVideoRange(params: { projectId: string; assetId: string; startMs: number; endMs?: number }) {
    if (this.transcriptionService === undefined) {
      return { success: false, error: 'Local speech inspection is unavailable.' };
    }
    return this.transcriptionService.inspectVideoSpeech(params);
  }

  @McpTool({
    description: 'Connect two clips on the same video track in canvas playback order. Moves the target directly after the source, closes gaps on that track and saves the sequence. Requires user approval.',
    input: z.object({ projectId: z.string().min(1), fromClipId: z.string().min(1), toClipId: z.string().min(1) })
  })
  async connectTimelineClips(params: { projectId: string; fromClipId: string; toClipId: string }) {
    if (this.projectStore === undefined) return { success: false, error: 'Project service is unavailable.' };
    try {
      const project = await this.projectStore.open(params.projectId);
      if (project === null) return { success: false, error: 'Project was not found.' };
      const timeline = connectVideoClips(project.timeline, params.fromClipId, params.toClipId);
      if (timeline === null) return { success: false, error: 'Choose two different clips on the same video track.' };
      await this.projectStore.saveTimeline(params.projectId, timeline);
      this.notifyProjectTimelineChanged?.(params.projectId);
      return { success: true, projectId: params.projectId, fromClipId: params.fromClipId, toClipId: params.toClipId };
    } catch {
      return { success: false, error: 'The clip connection could not be saved.' };
    }
  }

  @McpTool({
    description: 'Trim an existing timeline clip to a validated source range. This changes a saved project and requires explicit user approval.',
    input: z.object({
      projectId: z.string().min(1),
      clipId: z.string().min(1),
      sourceStartMs: z.number().finite().min(0),
      sourceEndMs: z.number().finite().min(0)
    })
  })
  async trimTimelineClip(params: {
    projectId: string;
    clipId: string;
    sourceStartMs: number;
    sourceEndMs: number;
  }) {
    if (!this.projectStore) {
      return { success: false, error: 'ProjectStore service is not available.' };
    }
    if (params.sourceEndMs <= params.sourceStartMs) {
      return { success: false, error: 'sourceEndMs must be greater than sourceStartMs.' };
    }

    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) {
        return { success: false, error: `Project ${params.projectId} not found.` };
      }

      let found = false;
      let rangeError: string | undefined;
      const tracks: TimelineTrack[] = project.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id !== params.clipId) return clip;
          found = true;
          if (params.sourceEndMs > clip.sourceDurationMs) {
            rangeError = `Trim range exceeds source duration for clip ${params.clipId}.`;
            return clip;
          }
          return { ...clip, sourceStartMs: params.sourceStartMs, sourceEndMs: params.sourceEndMs };
        })
      }));

      if (!found) {
        return { success: false, error: `Clip ${params.clipId} not found in project ${params.projectId}.` };
      }
      if (rangeError !== undefined) {
        return { success: false, error: rangeError };
      }

      await this.projectStore.saveTimeline(params.projectId, { ...project.timeline, tracks });
      this.notifyProjectTimelineChanged?.(params.projectId);
      return {
        success: true,
        projectId: params.projectId,
        clipId: params.clipId,
        sourceStartMs: params.sourceStartMs,
        sourceEndMs: params.sourceEndMs,
        message: `Trimmed clip ${params.clipId} in project ${params.projectId}`
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : `Failed to trim clip ${params.clipId}`
      };
    }
  }

  @McpTool({
    description:
      'Remove one clip from a project timeline. This changes a saved project and requires explicit user approval. ' +
      'Transitions that referenced the clip are dropped with it.',
    input: z.object({
      projectId: z.string().min(1),
      clipId: z.string().min(1)
    })
  })
  async removeTimelineClip(params: { projectId: string; clipId: string }) {
    if (!this.projectStore) {
      return { success: false as const, error: 'ProjectStore service is not available.' };
    }

    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) {
        return { success: false as const, error: `Project ${params.projectId} not found.` };
      }

      // deleteClip returns the timeline unchanged for an unknown id, so compare
      // rather than reporting success for a no-op.
      const nextTimeline = deleteClip(project.timeline, params.clipId);
      if (nextTimeline === project.timeline) {
        return { success: false as const, error: `Clip ${params.clipId} is not on the timeline of project ${params.projectId}.` };
      }

      await this.projectStore.saveTimeline(params.projectId, nextTimeline);
      this.notifyProjectTimelineChanged?.(params.projectId);

      return {
        success: true as const,
        projectId: params.projectId,
        clipId: params.clipId,
        message: `Removed clip ${params.clipId} from project ${params.projectId}`
      };
    } catch (err) {
      return {
        success: false as const,
        error: err instanceof Error ? err.message : `Failed to remove clip ${params.clipId}`
      };
    }
  }

  @McpTool({
    description: 'Update validated basic effects on one timeline clip. This changes a saved project and requires explicit user approval.',
    input: z.object({
      projectId: z.string().min(1),
      clipId: z.string().min(1),
      effects: z.object({
        opacity: z.number().finite().min(CLIP_EFFECT_RANGES.opacity.min).max(CLIP_EFFECT_RANGES.opacity.max).optional(),
        scale: z.number().finite().min(CLIP_EFFECT_RANGES.scale.min).max(CLIP_EFFECT_RANGES.scale.max).optional(),
        positionX: z.number().finite().min(CLIP_EFFECT_RANGES.positionX.min).max(CLIP_EFFECT_RANGES.positionX.max).optional(),
        positionY: z.number().finite().min(CLIP_EFFECT_RANGES.positionY.min).max(CLIP_EFFECT_RANGES.positionY.max).optional(),
        rotation: z.number().finite().min(CLIP_EFFECT_RANGES.rotation.min).max(CLIP_EFFECT_RANGES.rotation.max).optional(),
        volume: z.number().finite().min(CLIP_EFFECT_RANGES.volume.min).max(CLIP_EFFECT_RANGES.volume.max).optional(),
        speed: z.number().finite().min(CLIP_EFFECT_RANGES.speed.min).max(CLIP_EFFECT_RANGES.speed.max).optional()
          .describe('Playback rate. 2 is twice as fast and half as long on the timeline, so it can be refused for running into the next clip.'),
        brightness: z.number().finite().min(CLIP_EFFECT_RANGES.brightness.min).max(CLIP_EFFECT_RANGES.brightness.max).optional()
          .describe('Added. 0 is neutral.'),
        contrast: z.number().finite().min(CLIP_EFFECT_RANGES.contrast.min).max(CLIP_EFFECT_RANGES.contrast.max).optional()
          .describe('Multiplied. 1 is neutral.'),
        saturation: z.number().finite().min(CLIP_EFFECT_RANGES.saturation.min).max(CLIP_EFFECT_RANGES.saturation.max).optional()
          .describe('Multiplied. 1 is neutral, 0 is black and white.')
      }).refine((effects) => Object.keys(effects).length > 0, 'At least one effect must be provided.')
    })
  })
  async updateClipEffects(params: { projectId: string; clipId: string; effects: Partial<ClipEffects> }) {
    if (!this.projectStore) return { success: false, error: 'ProjectStore service is not available.' };
    const entries = Object.entries(params.effects) as readonly [keyof ClipEffects, number][];
    if (entries.length === 0) return { success: false, error: 'At least one effect must be provided.' };
    for (const [property, value] of entries) {
      const range = CLIP_EFFECT_RANGES[property];
      if (!Number.isFinite(value) || value < range.min || value > range.max) {
        return { success: false, error: `${property} must be between ${range.min} and ${range.max}.` };
      }
    }
    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) return { success: false, error: `Project ${params.projectId} not found.` };
      const exists = project.timeline.tracks.some((track) => track.clips.some((clip) => clip.id === params.clipId));
      if (!exists) return { success: false, error: `Clip ${params.clipId} not found in project ${params.projectId}.` };

      /*
        Through the shared rule, not written straight into the track.

        Writing directly was harmless while no effect changed a clip's length.
        Speed does: the phone produced a project it could not reopen that way —
        a transition survived on a cut whose clips no longer touched, and the
        validator refused the whole document on the next read. `updateClipEffects`
        prunes what an edit invalidates and refuses what it cannot do.
      */
      const next = applyClipEffects(project.timeline, { clipId: params.clipId, effects: params.effects });
      if (next === null) {
        // Which rule refused: "out of range" and "it would not fit" are
        // different problems for whoever is holding the tool.
        const clip = project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === params.clipId);
        const merged = { ...DEFAULT_CLIP_EFFECTS, ...(clip?.effects ?? {}), ...params.effects };
        return {
          success: false,
          error: isValidClipEffects(merged)
            ? 'That change would put the clip on top of its neighbour. Move the next clip along first, or choose a smaller change.'
            : 'One of those values is outside what the effect accepts.'
        };
      }
      await this.projectStore.saveTimeline(params.projectId, next);
      this.notifyProjectTimelineChanged?.(params.projectId);
      return { success: true, projectId: params.projectId, clipId: params.clipId, effects: params.effects };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : `Failed to update effects for clip ${params.clipId}` };
    }
  }

  @McpTool({
    description:
      'Split one timeline clip in two at a moment inside it. The split is where the cut goes; both halves ' +
      'keep the same source, so nothing is re-encoded. Fails if the moment is at or outside the clip\'s ' +
      'own span. This changes a saved project and requires explicit user approval.',
    input: z.object({
      projectId: z.string().min(1),
      clipId: z.string().min(1),
      atSeconds: z.number().min(0).describe('Timeline position, not an offset into the clip.')
    })
  })
  async splitTimelineClip(params: { projectId: string; clipId: string; atSeconds: number }) {
    if (!this.projectStore) return { success: false, error: 'ProjectStore service is not available.' };
    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) return { success: false, error: `Project ${params.projectId} not found.` };
      const rightClipId = `clip-split-${randomUUID()}`;
      const next = splitClip(project.timeline, {
        clipId: params.clipId,
        atMs: Math.round(params.atSeconds * 1_000),
        rightClipId
      });
      if (next === null) {
        return {
          success: false,
          error: `Clip ${params.clipId} cannot be split there: the moment has to be strictly inside it.`
        };
      }
      await this.projectStore.saveTimeline(params.projectId, next);
      this.notifyProjectTimelineChanged?.(params.projectId);
      return { success: true, projectId: params.projectId, leftClipId: params.clipId, rightClipId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : `Failed to split clip ${params.clipId}` };
    }
  }

  @McpTool({
    description:
      'Put words on the picture for a stretch of the timeline. Geometry is output-frame pixels measured ' +
      'from the centre, and the colour is #rrggbb — anything else is refused rather than guessed at. ' +
      'This changes a saved project and requires explicit user approval.',
    input: z.object({
      projectId: z.string().min(1),
      text: z.string().min(1),
      atSeconds: z.number().min(0),
      lengthSeconds: z.number().min(0.1).optional().describe('Defaults to three seconds.'),
      sizePx: z.number().min(8).max(512).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      positionX: z.number().optional(),
      positionY: z.number().optional()
    })
  })
  async addTimelineTitle(params: {
    projectId: string;
    text: string;
    atSeconds: number;
    lengthSeconds?: number;
    sizePx?: number;
    color?: string;
    positionX?: number;
    positionY?: number;
  }) {
    if (!this.projectStore) return { success: false, error: 'ProjectStore service is not available.' };
    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) return { success: false, error: `Project ${params.projectId} not found.` };
      const id = `title-${randomUUID()}`;
      const atMs = Math.round(params.atSeconds * 1_000);
      const added = addTitle(project.timeline, { id, atMs, text: params.text });

      // The optional parts go through the same update rule the editors use, so
      // a colour or a size this renderer cannot draw is refused here rather
      // than discovered at export.
      const changes: Record<string, number | string> = {};
      if (params.lengthSeconds !== undefined) changes.timelineEndMs = atMs + Math.round(params.lengthSeconds * 1_000);
      if (params.sizePx !== undefined) changes.sizePx = params.sizePx;
      if (params.color !== undefined) changes.color = params.color;
      if (params.positionX !== undefined) changes.positionX = params.positionX;
      if (params.positionY !== undefined) changes.positionY = params.positionY;
      const next = Object.keys(changes).length === 0 ? added : updateTitle(added, id, changes);
      if (next === null) return { success: false, error: 'Those title settings would leave nothing to draw.' };

      await this.projectStore.saveTimeline(params.projectId, next);
      this.notifyProjectTimelineChanged?.(params.projectId);
      return { success: true, projectId: params.projectId, titleId: id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to add a title' };
    }
  }

  @McpTool({
    description:
      'Remove one title by id. Read the project first if you do not have the id. This changes a saved ' +
      'project and requires explicit user approval.',
    input: z.object({ projectId: z.string().min(1), titleId: z.string().min(1) })
  })
  async removeTimelineTitle(params: { projectId: string; titleId: string }) {
    if (!this.projectStore) return { success: false, error: 'ProjectStore service is not available.' };
    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) return { success: false, error: `Project ${params.projectId} not found.` };
      const next = removeTitle(project.timeline, params.titleId);
      if (next === null) return { success: false, error: `Title ${params.titleId} is not in project ${params.projectId}.` };
      await this.projectStore.saveTimeline(params.projectId, next);
      this.notifyProjectTimelineChanged?.(params.projectId);
      return { success: true, projectId: params.projectId, titleId: params.titleId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to remove a title' };
    }
  }

  @McpTool({
    description:
      'Put a transition on the cut nearest a moment, or take one off. A transition needs two clips that ' +
      'touch on the same video track, and has to fit inside both — it is refused otherwise rather than ' +
      'shortened silently. All three kinds render as a dip through black, because clips do not overlap. ' +
      'This changes a saved project and requires explicit user approval.',
    input: z.object({
      projectId: z.string().min(1),
      atSeconds: z.number().min(0).describe('A moment near the cut; the nearest cut within half a second is used.'),
      type: z.enum(['fade', 'crossfade', 'dipToBlack']).optional().describe('Omit to remove the transition there.'),
      lengthSeconds: z.number().min(0.1).optional()
    })
  })
  async setTimelineTransition(params: {
    projectId: string;
    atSeconds: number;
    type?: 'fade' | 'crossfade' | 'dipToBlack';
    lengthSeconds?: number;
  }) {
    if (!this.projectStore) return { success: false, error: 'ProjectStore service is not available.' };
    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) return { success: false, error: `Project ${params.projectId} not found.` };
      const atMs = Math.round(params.atSeconds * 1_000);
      const cut = cutNearest(project.timeline, atMs, 500);
      if (cut === null) {
        return {
          success: false,
          error: `No cut within half a second of ${params.atSeconds}s. A transition goes where two clips touch.`
        };
      }
      if (params.type === undefined) {
        const cleared = removeTransitionAtCut(project.timeline, cut);
        await this.projectStore.saveTimeline(params.projectId, cleared);
        this.notifyProjectTimelineChanged?.(params.projectId);
        return { success: true, projectId: params.projectId, cutSeconds: cut.cutMs / 1_000, removed: true };
      }
      const next = setTransitionAtCut(project.timeline, cut, {
        type: params.type,
        ...(params.lengthSeconds === undefined ? {} : { durationMs: Math.round(params.lengthSeconds * 1_000) })
      });
      if (next === null) {
        return { success: false, error: 'A transition has to fit inside both of the clips it joins.' };
      }
      await this.projectStore.saveTimeline(params.projectId, next);
      this.notifyProjectTimelineChanged?.(params.projectId);
      return { success: true, projectId: params.projectId, cutSeconds: cut.cutMs / 1_000, type: params.type };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set a transition' };
    }
  }

  @McpTool({
    description:
      'Add a project asset to the timeline as a clip. Omit trackId to place it on the first track ' +
      'matching the asset kind, omit startOffsetSeconds to append after the last clip on that track, ' +
      'and omit durationSeconds to use the whole asset.',
    input: z.object({
      projectId: z.string().min(1),
      assetId: z.string().min(1),
      trackId: z.string().min(1).optional(),
      startOffsetSeconds: z.number().min(0).optional(),
      durationSeconds: z.number().min(0.1).optional()
    })
  })
  async addClipToTimeline(params: {
    projectId: string;
    assetId: string;
    trackId?: string | undefined;
    startOffsetSeconds?: number | undefined;
    durationSeconds?: number | undefined;
  }) {
    if (!this.projectStore) {
      return { success: false, error: 'ProjectStore service is not available.' };
    }

    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) {
        return { success: false, error: `Project ${params.projectId} not found.` };
      }

      const asset = project.assets.find((a) => a.id === params.assetId);
      if (!asset) {
        return { success: false, error: `Asset ${params.assetId} not found in project ${params.projectId}.` };
      }

      const target = resolveTimelineTrackForAsset(project.timeline, asset, params.trackId);
      if (!target.ok) {
        return { success: false, error: target.error };
      }
      const targetTrack = target.track;

      const clipId = `clip-${randomUUID()}`;
      const assetDurationMs = asset.metadata?.durationMs;
      const durationMs = params.durationSeconds !== undefined
        ? params.durationSeconds * 1000
        : assetDurationMs ?? FALLBACK_CLIP_DURATION_MS;
      const timelineStartMs = params.startOffsetSeconds !== undefined
        ? params.startOffsetSeconds * 1000
        : trackAppendStartMs(targetTrack);

      const newClip = {
        id: clipId,
        assetId: params.assetId,
        timelineStartMs,
        sourceStartMs: 0,
        sourceEndMs: assetDurationMs === undefined ? durationMs : Math.min(durationMs, assetDurationMs),
        sourceDurationMs: assetDurationMs ?? durationMs,
        effects: DEFAULT_CLIP_EFFECTS,
        keyframes: []
      };

      // The same placement rules the editor uses, so an agent edit can never
      // write a clip the UI would reject (overlaps, out-of-range source range).
      const nextTimeline = placeClip(project.timeline, { trackId: targetTrack.id, clip: newClip });
      if (nextTimeline === null) {
        return {
          success: false,
          error: `Could not place the clip at ${timelineStartMs / 1000}s on track ${targetTrack.id} — it would overlap an existing clip or fall outside the asset. Read the timeline first and pick a free range.`
        };
      }

      await this.projectStore.saveTimeline(params.projectId, nextTimeline);
      this.notifyProjectTimelineChanged?.(params.projectId);

      return {
        success: true,
        clipId,
        projectId: params.projectId,
        trackId: targetTrack.id,
        assetId: params.assetId,
        startOffsetSeconds: timelineStartMs / 1000,
        durationSeconds: clipDurationMs(newClip) / 1000,
        message: `Added clip ${clipId} to track ${targetTrack.id} in project ${params.projectId}`
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : `Failed to add clip to project ${params.projectId}`
      };
    }
  }

  @McpTool({
    // No quality parameter: the export pipeline has no preset concept
    // (StartExportJobInput carries size, frame rate and delivery policy), and the tool used
    // to accept one, drop it, and echo it back as if it had applied.
    description: 'Start FFmpeg MP4 export for an OpenScene project timeline. Exports at the project settings; preserve_provenance is the safe metadata default and privacy_clean removes only an explicit personal-container-tag allowlist.',
    input: z.object({
      projectId: z.string().min(1),
      metadataPrivacyMode: z.enum(METADATA_PRIVACY_MODES).optional()
    })
  })
  async exportProjectVideo(params: { projectId: string; metadataPrivacyMode?: MetadataPrivacyMode }) {
    if (!this.exportIpcService) {
      return { success: false, error: 'Export service is not available.' };
    }

    try {
      const response = await this.exportIpcService.startExportJob({
        projectId: params.projectId,
        ...(params.metadataPrivacyMode === undefined ? {} : { metadataPrivacyMode: params.metadataPrivacyMode })
      });

      if (!response.ok) {
        return {
          success: false,
          error: response.error.message
        };
      }

      return {
        success: true,
        exportJobId: response.value.id,
        projectId: params.projectId,
        message: `Started FFmpeg export job ${response.value.id} for project ${params.projectId}`
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : `Failed to export project ${params.projectId}`
      };
    }
  }

  @McpResource({
    uri: 'openvideo://mcp-capabilities',
    mimeType: 'application/json',
    description: 'OpenScene MCP Server Capability Descriptor'
  })
  readCapabilities() {
    return {
      server: 'openvideo-mcp-server',
      version: '0.1.0',
      /*
        Read off the decorated methods rather than typed out again.

        Hand-written, it went stale the moment the agent gained the edits it
        could not reach: fifteen names advertised against nineteen registered,
        with splitting a clip, titles and transitions missing from the list of
        what this server can do. A descriptor that disagrees with the server is
        worse than none — it is what a client believes.
      */
      // `getMcpServerDefinition` returns undefined for a class it has no
      // metadata for, which for this one would mean the decorators did not run.
      tools: (getOpenVideoMcpDefinition()?.tools ?? []).map((tool) => tool.name)
    };
  }
}

export function getOpenVideoMcpDefinition() {
  return getMcpServerDefinition(OpenVideoMcpServer);
}
