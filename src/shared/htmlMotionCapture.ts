/**
 * Platform-free preparation for HTML overlay capture, not an exporter.
 * Times are absolute composition milliseconds, on the export's frame grid.
 * Cue intervals are half-open; overlapping cues need only one composition capture.
 */
export type HtmlMotionCaptureCue = {
  readonly startMs: number;
  readonly endMs: number;
};

export type HtmlMotionCaptureRange = {
  readonly firstFrame: number;
  readonly endFrameExclusive: number;
};

export type HtmlMotionCapturePlan = {
  readonly frameRate: number;
  readonly ranges: readonly HtmlMotionCaptureRange[];
  readonly captureFrameCount: number;
};

const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_CUES = 10_000;

function assertFrameRate(frameRate: number): void {
  // Same integer frame-rate domain as StartExportJobInput's validator.
  if (!Number.isInteger(frameRate) || frameRate < 1 || frameRate > 120) {
    throw new Error('HTML motion capture requires an integer frame rate from 1 to 120.');
  }
}

function firstFrameAtOrAfter(timeMs: number, frameRate: number): number {
  let frame = Math.ceil(timeMs * frameRate / 1000);
  // Avoid an extra/missing sample from round-off when timeMs itself came from
  // an exact grid timestamp (e.g. 1000 / 30). Do not use a broad epsilon that
  // would change the meaning of genuinely off-grid cue boundaries.
  if (frame > 0 && (frame - 1) * 1000 / frameRate >= timeMs) frame -= 1;
  if (frame * 1000 / frameRate < timeMs) frame += 1;
  return frame;
}

/**
 * Sparse ranges keep long empty gaps cheap. Captures never extend past duration.
 * Bounds reject malformed/unbounded work before a platform opens a webview.
 * No input mutation; cue order has no effect on the resulting schedule.
 */
export function planHtmlMotionCapture(
  cues: readonly HtmlMotionCaptureCue[],
  durationMs: number,
  frameRate: number
): HtmlMotionCapturePlan {
  assertFrameRate(frameRate);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS) {
    throw new Error('HTML motion capture duration must be positive and at most 24 hours.');
  }
  if (cues.length > MAX_CUES) throw new Error('HTML motion capture has too many cues.');
  const ranges: HtmlMotionCaptureRange[] = [];
  for (const cue of cues) {
    if (!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs)
      || cue.startMs < 0 || cue.endMs <= cue.startMs || cue.endMs > MAX_DURATION_MS) {
      throw new Error('HTML motion capture cue must have a finite, positive interval within 24 hours.');
    }
    const firstFrame = firstFrameAtOrAfter(cue.startMs, frameRate);
    const endFrameExclusive = firstFrameAtOrAfter(Math.min(cue.endMs, durationMs), frameRate);
    if (firstFrame < endFrameExclusive) ranges.push({ firstFrame, endFrameExclusive });
  }
  ranges.sort((a, b) => a.firstFrame - b.firstFrame || a.endFrameExclusive - b.endFrameExclusive);
  const merged: HtmlMotionCaptureRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.firstFrame <= previous.endFrameExclusive) {
      merged[merged.length - 1] = {
        firstFrame: previous.firstFrame,
        endFrameExclusive: Math.max(previous.endFrameExclusive, range.endFrameExclusive)
      };
    } else {
      merged.push(range);
    }
  }
  return {
    frameRate,
    ranges: merged,
    captureFrameCount: merged.reduce((count, range) => count + range.endFrameExclusive - range.firstFrame, 0)
  };
}

/** Lazy iteration permits cancellation between captures without allocating a frame array. */
export function* htmlMotionCaptureSamples(
  cues: readonly HtmlMotionCaptureCue[],
  durationMs: number,
  frameRate: number
): Generator<{ readonly frameIndex: number; readonly timeMs: number }> {
  const plan = planHtmlMotionCapture(cues, durationMs, frameRate);
  for (const range of plan.ranges) {
    for (let frameIndex = range.firstFrame; frameIndex < range.endFrameExclusive; frameIndex += 1) {
      yield { frameIndex, timeMs: frameIndex * 1000 / frameRate };
    }
  }
}

export type HtmlMotionRenderIdentity = {
  /** Exact, self-contained HTML. Do not trim/normalize it or fetch resources here. */
  readonly compositionHtml: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  /** Host-supplied capture engine/version + rendering environment revision. */
  readonly rendererRevision: string;
};

/**
 * SHA-256 is supplied by the host (like oauthPkce): Node crypto on desktop,
 * a native digest on mobile. The callback hashes the supplied string as UTF-8
 * and returns 64 hex characters. No Node, DOM or crypto globals in this module.
 * This identifies a composition, not a complete capture artifact: cached frames
 * must ALSO match their frameIndex. A cache miss is not a transparent frame.
 */
export async function createHtmlMotionRenderKey(
  input: HtmlMotionRenderIdentity,
  sha256: (utf8: string) => string | Promise<string>
): Promise<string> {
  assertFrameRate(input.frameRate);
  if (!Number.isInteger(input.width) || input.width < 1 || input.width > 8192
    || !Number.isInteger(input.height) || input.height < 1 || input.height > 8192) {
    throw new Error('HTML motion capture dimensions must be integers from 1 to 8192.');
  }
  if (typeof input.compositionHtml !== 'string' || input.compositionHtml.trim().length === 0
    || input.compositionHtml.length > 8 * 1024 * 1024) {
    throw new Error('HTML motion capture requires nonempty HTML of at most 8 Mi characters.');
  }
  if (typeof input.rendererRevision !== 'string' || !input.rendererRevision.trim()
    || input.rendererRevision.length > 256) {
    throw new Error('HTML motion capture requires a rendering environment revision.');
  }
  const digest = await sha256(JSON.stringify([
    'openscene-html-motion-v1', input.compositionHtml,
    input.width, input.height, input.frameRate, input.rendererRevision
  ]));
  if (!/^[a-fA-F0-9]{64}$/.test(digest)) {
    throw new Error('HTML motion capture requires a SHA-256 hex digest.');
  }
  return `openscene-html-motion-v1-${digest.toLowerCase()}`;
}
