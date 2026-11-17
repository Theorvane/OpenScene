# HTML motion capture preparation (partial #490)

`src/shared/htmlMotionCapture.ts` is an independently usable preparation contract,
not an enabled preview or export path. Public `dev` has no `TimelineMotion` model,
composition generator or `editaMotionSeek` bridge from the unpublished #488/#489
prototype. This change deliberately does not invent a competing model, run HTML,
install HyperFrames, or claim that exported MP4s match the preview. No UI, desktop
exporter, mobile exporter, native module, workflow or dependency is changed.

## Schedule contract

- Adapt the eventual cue model to `{ startMs, endMs }`, in **absolute composition
  milliseconds**, and supply the export duration and integer frame rate (1–120,
  matching current export validation). Intervals are `[startMs, endMs)`.
- `planHtmlMotionCapture` clips cues to the export duration, merges overlapping
  and adjacent frame ranges, and counts unique captures. It never rounds a cue's
  start to a local zero or captures the final endpoint. A sub-frame cue with no
  export sample in its interval produces no capture.
- `htmlMotionCaptureSamples` lazily yields `{ frameIndex, timeMs }` in increasing
  frame order. `timeMs = frameIndex * 1000 / frameRate`; a future bridge must
  convert milliseconds to seconds if its seek API expects seconds. Stop consuming
  the iterator to cancel further scheduling; cancel an already-started platform
  capture separately. Validation occurs when iteration starts.
- Empty cue sets and gaps are not rasterized. Sparse ranges avoid an allocation
  proportional to project length. Inputs are not mutated. Duration/cue times are
  bounded to 24 hours, cue count to 10,000. Invalid inputs throw rather than
  silently dropping overlays. Fractional frame rates are deliberately rejected
  until the exporters share a rational-rate contract.

## Render identity contract

`createHtmlMotionRenderKey` hashes a versioned JSON tuple containing **exact HTML**,
width, height, frame rate and `rendererRevision`. The host injects SHA-256 over
UTF-8 and returns a 64-character hex digest (sync or async). This follows the
existing `oauthPkce.ts` boundary: no Node crypto, Buffer, DOM, Web Crypto, or
Hermes assumptions in shared code. Tests use Node SHA-256 only as the host adapter.
There are no production digest adapters or callers in this partial PR.

HTML must be self-contained, including cue timing and embedded resources; this
module neither sanitizes nor executes it. Never treat a key as permission to run
untrusted HTML. An eventual webview must enforce offline resource/navigation and
script boundaries separately. `rendererRevision` must identify engine/version,
fonts, scale/color/alpha setup and any other rendering-environment change that can
change pixels. Byte-different HTML intentionally invalidates the key.

The returned key identifies a composition, **not one frame**: a frame cache must
also match `frameIndex`. Never accept a missing cached frame as a successful
transparent overlay. Dimensions are bounded to 1–8192; HTML to 8 Mi characters;
revision to 256 characters. A rejected/failed hash does not produce a fallback key.

## Remaining work before enabling export

1. Publish and review the #488/#489 composition and seek bridge; adapt its actual
   cue model rather than treating this standalone interval type as a replacement.
2. Wire both desktop and iOS callers to this same schedule/key and implement their
   host digest adapters. No surface is marked complete by this shared-core PR.
3. Prove transparent deterministic captures at equal sample times, and ensure
   engine/environment revisions invalidate stale frame caches.
4. Implement FFmpeg/iOS compositing, frame-cache lifecycle, in-flight cancellation,
   and visible unsupported/capture-failure reporting. Keep the current native
   exporter unchanged until those are tested.
5. Compare extracted MP4 frames against preview samples, run both typechecks,
   tests/build, and exercise desktop + iOS development clients. None of the live
   preview, capture, native export or extracted-frame checks is claimed here.

#490 must remain open after this slice. This implements scope item 1 only, not
its complete preview/export equivalence acceptance criteria.
