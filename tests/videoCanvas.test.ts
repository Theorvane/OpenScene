import { describe, expect, it } from 'vitest';
import { connectVideoClips } from '../src/shared/videoCanvas';
import { DEFAULT_CLIP_EFFECTS, type TimelineDocument } from '../src/shared/timelineTypes';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import { OpenVideoMcpServer } from '../src/main/openVideoMcpServer';
import { createAgentChatTools, agentChatMutatingToolNames } from '../src/main/agentChatTools';

function sequence(): TimelineDocument {
  const base = createInitialTimeline();
  return {
    ...base,
    tracks: base.tracks.map((track) => track.kind !== 'video' ? track : {
      ...track, clips: ['a', 'b', 'c'].map((id, index) => ({
        id, assetId: id, timelineStartMs: index * 2000, sourceStartMs: 1000, sourceEndMs: 3000,
        sourceDurationMs: 6000, effects: { ...DEFAULT_CLIP_EFFECTS, speed: id === 'c' ? 2 : 1 }, keyframes: [{ timelineTimeMs: index * 2000 + 200, property: 'opacity' as const, value: 0.5, interpolation: 'linear' as const }]
      }))
    }),
    transitions: [{ fromClipId: 'a', toClipId: 'b', type: 'crossfade', durationMs: 300 }]
  };
}

describe('connected video canvas', () => {
  it('moves the target after its source, preserves source ranges, respects playback speed and drops obsolete transitions', () => {
    const before = sequence();
    const after = connectVideoClips(before, 'a', 'c')!;
    const clips = after.tracks.find((track) => track.kind === 'video')!.clips;
    expect(clips.map((clip) => [clip.id, clip.timelineStartMs])).toEqual([['a', 0], ['c', 2000], ['b', 3000]]);
    expect(clips.every((clip) => clip.sourceStartMs === 1000 && clip.sourceEndMs === 3000)).toBe(true);
    expect(after.transitions).toEqual([]);
    expect(clips.map((clip) => clip.keyframes[0]?.timelineTimeMs)).toEqual([200, 2200, 3200]);
    expect(before.tracks.find((track) => track.kind === 'video')!.clips.map((clip) => clip.id)).toEqual(['a', 'b', 'c']);
  });

  it('rejects missing clips, self connections and clips on separate tracks', () => {
    expect(connectVideoClips(sequence(), 'a', 'a')).toBeNull();
    expect(connectVideoClips(sequence(), 'a', 'missing')).toBeNull();
    const before = sequence();
    const track = before.tracks.find((candidate) => candidate.kind === 'video')!;
    expect(connectVideoClips({
      ...before, tracks: [{ ...track, clips: track.clips.slice(0, 1) }, { ...track, id: 'other', clips: track.clips.slice(1) }]
    }, 'a', 'b')).toBeNull();
  });

  it('exposes approved clip connections and removes media generation from Edit Agent', async () => {
    const tools = await createAgentChatTools(new OpenVideoMcpServer());
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('connectTimelineClips');
    expect(agentChatMutatingToolNames(tools).has('connectTimelineClips')).toBe(true);
    expect(names).not.toContain('createVideoJob');
    expect(names).not.toContain('createImageJob');
    expect(names).not.toContain('createSpeechJob');
    expect(names).toContain('watchProjectVideo');
    expect(names).toContain('transcribeProjectVideoRange');
  });
});
