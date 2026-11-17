import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createHtmlMotionRenderKey,
  htmlMotionCaptureSamples,
  planHtmlMotionCapture,
  type HtmlMotionRenderIdentity
} from '../src/shared/htmlMotionCapture';

const digest = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const identity: HtmlMotionRenderIdentity = {
  compositionHtml: '<html><body>مرحبا 🎬</body></html>',
  width: 1280, height: 720, frameRate: 30, rendererRevision: 'test-engine-v1'
};

describe('HTML motion capture schedule', () => {
  it('captures the eight-second proof at 30 fps, without the endpoint', () => {
    const samples = [...htmlMotionCaptureSamples([{ startMs: 0, endMs: 8000 }], 8000, 30)];
    expect(samples).toHaveLength(240);
    expect(samples[0]).toEqual({ frameIndex: 0, timeMs: 0 });
    expect(samples.at(-1)).toEqual({ frameIndex: 239, timeMs: 239 * 1000 / 30 });
  });

  it('merges overlap/adjacency, skips gaps and ignores input order without mutation', () => {
    const cues = Object.freeze([
      Object.freeze({ startMs: 3000, endMs: 4000 }),
      Object.freeze({ startMs: 500, endMs: 2000 }),
      Object.freeze({ startMs: 0, endMs: 1000 }),
      Object.freeze({ startMs: 2000, endMs: 2100 })
    ]);
    expect(planHtmlMotionCapture(cues, 4000, 10)).toEqual({
      frameRate: 10, captureFrameCount: 31,
      ranges: [{ firstFrame: 0, endFrameExclusive: 21 }, { firstFrame: 30, endFrameExclusive: 40 }]
    });
    expect(planHtmlMotionCapture([...cues].reverse(), 4000, 10))
      .toEqual(planHtmlMotionCapture(cues, 4000, 10));
  });

  it('samples half-open off-grid cues at absolute times, not rounded cue-local times', () => {
    expect([...htmlMotionCaptureSamples([{ startMs: 1, endMs: 101 }], 1000, 30)])
      .toEqual([1, 2, 3].map((frameIndex) => ({ frameIndex, timeMs: frameIndex * 1000 / 30 })));
    expect([...htmlMotionCaptureSamples([{ startMs: 1, endMs: 2 }], 1000, 30)]).toEqual([]);
  });

  it('does not move exact or genuinely off-grid boundaries using an epsilon', () => {
    for (const frameRate of [1, 24, 25, 30, 60, 120]) {
      for (let frame = 1; frame < 250; frame += 1) {
        const startMs = frame * 1000 / frameRate;
        const endMs = (frame + 1) * 1000 / frameRate;
        expect(planHtmlMotionCapture([{ startMs, endMs }], 300000, frameRate).ranges)
          .toEqual([{ firstFrame: frame, endFrameExclusive: frame + 1 }]);
        expect(planHtmlMotionCapture([{ startMs: startMs + 1e-8, endMs }], 300000, frameRate).ranges)
          .toEqual([]);
      }
    }
  });

  it('clips to the export duration and returns no frames for empty/out-of-range cues', () => {
    expect([...htmlMotionCaptureSamples([{ startMs: 900, endMs: 2000 }], 1000, 10)])
      .toEqual([{ frameIndex: 9, timeMs: 900 }]);
    expect(planHtmlMotionCapture([{ startMs: 1000, endMs: 2000 }], 1000, 30).ranges).toEqual([]);
    expect(planHtmlMotionCapture([], 1000, 30).captureFrameCount).toBe(0);
  });

  it('is lazy for long compositions and permits callers to stop between frames', () => {
    const samples = htmlMotionCaptureSamples([{ startMs: 0, endMs: 86400000 }], 86400000, 120);
    expect(samples.next().value).toEqual({ frameIndex: 0, timeMs: 0 });
    expect(samples.return(undefined)).toEqual({ done: true, value: undefined });
  });

  it.each([0, -1, NaN, Infinity, 121, 29.97])('rejects unsupported frame rate %s', (frameRate) => {
    expect(() => planHtmlMotionCapture([], 1000, frameRate)).toThrow();
  });
  it.each([0, -1, NaN, Infinity, 86400001])('rejects invalid duration %s', (duration) => {
    expect(() => planHtmlMotionCapture([], duration, 30)).toThrow();
  });
  it.each([
    { startMs: -1, endMs: 100 }, { startMs: 100, endMs: 100 },
    { startMs: 101, endMs: 100 }, { startMs: NaN, endMs: 100 },
    { startMs: 0, endMs: Infinity }, { startMs: 0, endMs: 86400001 }
  ])('rejects invalid cue %j', (cue) => {
    expect(() => planHtmlMotionCapture([cue], 1000, 30)).toThrow();
  });
  it('rejects excessive cues before creating a schedule', () => {
    expect(() => planHtmlMotionCapture(Array(10001).fill({ startMs: 0, endMs: 1 }), 1000, 30)).toThrow();
  });
});

describe('HTML motion render identity', () => {
  it('hashes a versioned unambiguous UTF-8 tuple; accepts sync or async host digest', async () => {
    const expected = `openscene-html-motion-v1-${digest(JSON.stringify([
      'openscene-html-motion-v1', identity.compositionHtml, 1280, 720, 30, 'test-engine-v1'
    ]))}`;
    expect(await createHtmlMotionRenderKey(identity, digest)).toBe(expected);
    expect(await createHtmlMotionRenderKey(identity, async (text) => digest(text).toUpperCase())).toBe(expected);
    expect(expected).not.toContain('مرحبا');
  });
  it.each([
    { compositionHtml: identity.compositionHtml + ' ' }, { width: 1920 }, { height: 1080 },
    { frameRate: 60 }, { rendererRevision: 'different-engine' }
  ])('invalidates the cache for %j', async (change) => {
    expect(await createHtmlMotionRenderKey({ ...identity, ...change }, digest))
      .not.toBe(await createHtmlMotionRenderKey(identity, digest));
  });
  it.each([
    { compositionHtml: '' }, { compositionHtml: ' ' }, { compositionHtml: 'x'.repeat(8 * 1024 * 1024 + 1) },
    { width: 0 }, { width: Infinity }, { height: 1.5 }, { height: 8193 },
    { frameRate: 29.97 }, { rendererRevision: '' }, { rendererRevision: 'x'.repeat(257) }
  ])('rejects invalid identity without invoking the digest %#', async (change) => {
    const hash = vi.fn(digest);
    await expect(createHtmlMotionRenderKey({ ...identity, ...change }, hash)).rejects.toThrow();
    expect(hash).not.toHaveBeenCalled();
  });
  it.each(['', 'a'.repeat(63), 'g'.repeat(64), 'a'.repeat(65)])('rejects an invalid digest %#', async (hash) => {
    await expect(createHtmlMotionRenderKey(identity, () => hash)).rejects.toThrow();
  });
  it('propagates host hash failure rather than returning a reusable fallback key', async () => {
    await expect(createHtmlMotionRenderKey(identity, async () => { throw new Error('host failed'); }))
      .rejects.toThrow('host failed');
  });
});
