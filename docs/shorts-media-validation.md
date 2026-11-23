# Local multishorts media verification

This infrastructure harness generates synthetic media and measures files. It does
not implement candidate selection, call the product batch API, or prove the full
OpenScene workflow. Candidate data fixtures belong to the LLM implementation.
No media, model, or extra npm package is committed. Use existing FFmpeg/FFprobe
executables with libx264 and AAC; `FFMPEG_PATH` and `FFPROBE_PATH` may select them.
The script fails explicitly when an executable is unavailable or exits nonzero.

## Reproduce

Run from the repository root with Node 22 or later. Each destination must be new;
the generator refuses to replace originals. Commands need no model or network.

```sh
node scripts/shorts-media.mjs generate /tmp/openscene-fixtures
node scripts/shorts-media.mjs self-test /tmp/openscene-smoke smoke
node scripts/shorts-media.mjs self-test /tmp/openscene-product product
node scripts/shorts-media.mjs verify /path/to/export.mp4 product 3 tone
node scripts/shorts-media.mjs verify-srt /path/to/export.srt 2 5
```

The three 12-second 640×360, 30 fps H264/yuv420p sources contain the same moving
test pattern: `tone.mp4` has a 440 Hz sine in AAC, `silent.mp4` has silent AAC,
and `absent.mp4` has no audio stream. The sine is an audio integrity test, not
speech and not an ASR accuracy fixture. `captions.srt` has fixed text with cues
at 1–2.5 seconds and 5–7 seconds. Artifact names and decoded characteristics
are reproducible; encoded bytes may differ across FFmpeg builds. Evidence records
the actual FFmpeg version. Retain evidence with the tested Git SHA.

## Output checks

`smoke` means exactly 360×640; `product` means exactly 1080×1920. Both require
square pixels, one H264/yuv420p video stream and 30 fps. The smaller smoke run
does not prove the product resolution works. The checker decodes every video
frame and checks container and individual video/audio durations against requested
seconds, with initial fixture tolerance `max(0.100 seconds, 2/fps)`. This is a
test tolerance to calibrate against actual output, not a product duration policy.

Use `tone`, `silent`, or `absent` for the expected audio output. Present audio
requires exactly one AAC stream. Decode to mono 8 kHz float PCM; whole-file RMS
must be at least 0.01 for the sine and at most 0.0001 for silence. These linear
amplitude thresholds distinguish these synthetic fixtures only; they do not
classify real speech. No-audio input may be exported as silence by the product:
choose `silent` when that is the confirmed product contract. Never infer output
stream absence merely from input absence.

Self-test trims each source from 2 to 5 seconds and fits it to the selected
portrait profile. It verifies all three files and confirms rejection of wrong
duration, wrong audible/silent expectation, and wrong audio stream count. This
calibrates the independent checker; these FFmpeg commands bypass OpenScene.

## Subtitle evidence

Product subtitle delivery uses `SubtitleDelivery` from
`src/shared/subtitleDelivery.ts`: `burnAutomaticCaptions` plus `sidecarFormat`
(`none`, `srt`, `vtt`, `ass`). Manual titles remain burn-in. Default is automatic
caption burn-in with no sidecar. Compare emitted cue text and timestamps against
the saved timeline after trimming/rebasing; do not compare source timestamps
directly with a shortened output. Parse each chosen sidecar format and require
ordered, positive intervals bounded by output duration. Sidecar content checks
and visual burn-in review are separate checks. Paired decoded frames with/without
captions during and outside cues are supporting evidence of rendering only;
pixel differences do not prove the words or cue timing are correct. Inspect
cue text and frames at cue boundaries and midpoints for content/timing evidence.
`verify-srt` checks fixture cue text/count and clipping/rebasing for the supplied
source start/end seconds (within 0–12); it uses millisecond precision. Self-test
checks original and trimmed cues and rejects an untrimmed sidecar. This command
can inspect a product-emitted SRT once the product path is available. VTT/ASS
and visual burn-in are still manual checks; harness self-test does not establish
product sidecar or burn-in behavior.

## Batch and cancellation integration gate

At baseline `b8e1f1a27e731d471f40286652441431eeb95fc6`, export exposes
`startExportJob({projectId,width?,height?,frameRate?,subtitleDelivery?})`,
`getExportJob({jobId})`, and `cancelExportJob({jobId})`.
Job kinds are `queued`, `running`, `completed`, `failed`, `cancelled`.
There is no batch status contract at that baseline. Do not invent one here.

Backend shared contract (issue #549, observed commit
`4801a8119d025c891545be64b838e34f80a92579`; runtime still pending):
`shortsStart({projectId,assetId,modelId,requestedCount?,minDurationMs?,maxDurationMs?,openAiAuthMode?,ollamaBaseUrl?,reasoningEffort?})`, `shortsGet({jobId})`,
`shortsCancel({jobId})`, `shortsMaterialize({jobId,candidateIds})`, and
`shortsExport({jobId,resultProjectIds})`. Stages are selecting/review/creating/
exporting/completed/partial/failed/cancelling/cancelled (also transcribing); items carry candidateId,
resultProjectId, exportJobId, status and error. Await settlement and
`cleanupComplete=true` before terminal cleanup assertions. Outputs use
1080×1920@30, fit contain, and approved caption cues; source projects stay
unchanged. Keep successful sibling outputs; remove failed/incomplete projects.
Retry failed candidates in a new job without replacing completed files.
All methods return `Promise<ApiResponse<...>>`; `shortsList({projectId})` loads
saved jobs/recipes. Each shortsExport call creates a fresh job with parentJobId:
poll the returned new ID, preserving previous runs. `shortsCancel` returns only
`{accepted:boolean}`. Saved nonterminal work becomes failed/interrupted after
restart, without automatic execution resume. The default candidate minimum is
15 seconds, so the 12-second fixture requires explicit minDurationMs/maxDurationMs
settings or a documented refusal test. Do not silently claim default candidate
generation succeeded with it.
Source timestamps are safe integer milliseconds and obey
`0 <= start < end <= duration` exactly: decode tolerance never relaxes this rule.

Once the Backend contract lands, verify two successful outputs and an isolated
failure in a mixed batch, preserving completed artifacts and per-item reasons.
Test queued and running cancellation separately. A cancellation acceptance or
`cancelled` state does not establish cleanup: the current service marks state
before the execution's `finally` removes staging and partial outputs. Integration
must await the Backend's confirmed quiescence signal, check every owned FFmpeg
child has exited, and require no owned staging, partial MP4, subtitle, or
provenance files. Preserve all completed sibling outputs and original media.
Bound this wait (proposed 10 seconds after acceptance); timeout fails cleanup
verification and records remaining owned PIDs/files without killing unrelated
processes. Until a quiescence observation contract is available, report this as
unverified. Keep product execution results distinct from harness self-tests.

## Dependency and packaging scope

This PR adds no runtime dependency or bundled binary. Homebrew FFmpeg used for
local validation is a development tool, not a product distribution decision.
The pinned FFmpeg skill is `3145261a1c19f399b9520fad7fdac741871e1426`
(MIT; see its LICENSE and `.agents/skills/ffmpeg-skill/UPSTREAM.json`).
FFmpeg binary licensing depends on its actual build configuration, including
GPL codecs such as libx264; a skill's MIT license does not cover that binary.
Before distributing any newly selected OSS, record exact component/version or
model hash → invoked product function → integrated-SHA output evidence → shipped
LICENSE/NOTICE/source obligations, including transitive dependencies. Backend
and LLM owners select components; this harness adds none and cannot establish
their product-path or distribution compliance. Existing mobile CI stays intact.

## Local calibration evidence

On macOS arm64, session Node v26.8.2 and Homebrew FFmpeg 9.0.2_1 (FFmpeg reports
9.0.2), both smoke and product self-tests produced exactly 3.000-second outputs
at 30 fps. Tone RMS was 0.08910602654347122, silent RMS 0, and absent audio had
zero streams at both resolutions. These measurements support the initial 0.01 /
0.0001 RMS thresholds and 100 ms duration tolerance for this synthetic input.
All deliberate negative expectations and original/rebased SRT checks passed.
One product frame was inspected at 1 second: the landscape test pattern is
centered with black space above/below in the portrait frame (contain).
No burned captions were rendered in this calibration.

Root typecheck, mobile typecheck, build, and 206 test files / 1286 tests passed.
An earlier run prepending Homebrew to PATH selected its different Node binary;
the managed-runtime test copies that executable and failed its health check.
Keeping the session Node first and appending `/opt/homebrew/bin` passed the full
suite. This is environment evidence, not a product change. No new OSS component,
model, or bundled binary was added. Full candidate→approval→materialize→batch
export/partial failure/cancel verification remains dependent on a committed,
integrated Backend/LLM runtime SHA and its settlement hook.
