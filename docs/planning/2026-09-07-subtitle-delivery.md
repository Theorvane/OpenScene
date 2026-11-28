# Timeline caption delivery

This guide describes the current delivery contract for captions already applied to the shared timeline. Canvas output is applied before export; caption styling and delivery use the same timeline as manual and agent edits. The dated path is retained for existing links.

Issue: [#330](https://github.com/Theorvane/openscene/issues/330)

## Outcome

- Desktop export now makes automatic-caption delivery explicit: burn approved automatic captions into the MP4, create one optional SRT/WebVTT/ASS sidecar, do both, or do neither.
- Manual timeline titles are never removed by the automatic-caption burn choice.
- Sidecars are generated deterministically from the automatic caption titles already applied to the authoritative timeline. A requested sidecar with no applied automatic captions is refused before an export job is created.
- The completed job reports only the generated MP4 and sidecar filenames. The renderer still receives no output path, FFmpeg path, or arguments; Reveal opens the app-owned export folder containing both files.

## Shared contract

`src/shared/subtitleDelivery.ts` owns caption selection, the burn-in timeline projection, delivery validation, and UTF-8 SRT/VTT/ASS serialization. Desktop export uses this burn-in projection.

The delivery contract is bounded to 5,000 cues, 500 characters per cue, and two hours. WebVTT markup and ASS override syntax are neutralized so caption text cannot become subtitle control syntax.

## Output lifecycle and safety

- The MP4 process must complete and its contained output must validate before a sidecar is written.
- Sidecar names are generated from the validated job ID; no renderer-controlled filename or path crosses IPC.
- Files use create-new semantics and no-follow validation, so an existing file or symlink is never overwritten.
- A sidecar write/validation failure fails the whole job and removes the partial MP4 and any sidecar created by that attempt.
- Existing exports without `subtitleDelivery` retain their behavior: all timeline titles are burned and no sidecar is created.

## Platform scope

Mobile support is deferred by the 2026-11-28 desktop-first decision. Native mobile caption delivery is not an active implementation or verification requirement.

## Verification

Run focused subtitle/export tests and root type checks after changes. Verify burn-only, sidecar-only, both and neither against the saved timeline. Manual titles must remain; requesting a sidecar without automatic captions must fail before starting a job.

The latest revision-specific suite and app results are in [canvas/export verification](../canvas-export-verification.md). Historical Windows failures are not the current verification status.

## Deferred

- word-level karaoke and forced alignment;
- speaker diarization and translation;
- audio ducking and loudness normalization.
