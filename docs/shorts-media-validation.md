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
model, or bundled binary was added. This initial calibration did not execute
candidate→approval→materialize→batch export. The later pinned-runtime checks
below establish that separate service/media evidence.

## Opt-in real product service verification

`node scripts/verify-shorts-product.mjs` is separate from the independent smoke
CI. It requires the Backend/LLM runtime (`src/main/shortsService.ts`) and installed
root/mobile dependencies in a clean, isolated runtime checkout. On older dev it
exits nonzero with an explicit missing-runtime message. Never treat that as a
skip/pass. It creates fresh fixtures, temporarily writes one generated Vitest
file under `tests/` with exclusive creation, and removes only that file on exit.
Fixtures, projects, jobs, actual exports and evidence stay in printed temporary
directories. `execution.json` records runtime Git SHA and SHA-256 of the three
harness files, preserving the distinction between test code and product code.

To test a runtime branch before this harness is merged, overlay only
`scripts/shorts-media.mjs`, `scripts/verify-shorts-product.mjs` and
`scripts/shorts-product.integration.ts.template` from this PR in a dedicated clean
runtime checkout. Do not overwrite tracked files or use another worker's checkout.
No product source modification is needed. The template is intentionally outside
the regular test glob because older dev has no ShortsService API.

```sh
VIDEO_TOOL_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg \
FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg \
FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe \
OPENSCENE_SHORTS_UNSUPPORTED_FFMPEG=/opt/homebrew/bin/ffmpeg \
node scripts/verify-shorts-product.mjs
```

The final variable is optional: it explicitly supplies a known build lacking
drawtext to verify product refusal. Omission does not establish that negative
case. The matching explicit FFmpeg/FFprobe paths are required. This does not
change the default FFmpeg link or shell PATH. Product captions use drawtext;
the libass `subtitles` filter is not required by the compiler. Independent smoke
does not render captions and cannot detect missing drawtext by itself.

The opt-in test uses real ProjectStore, AssetLibraryStore, ShortsService,
ExportIpcService, FFprobe and FFmpeg. Declared transcript cues and a deterministic
provider response are test inputs; no ASR, live model or paid provider is called.
It creates eight portrait outputs (two per audible/silent/no-audio/90°-rotated
source), checks streams/length/RMS, measured displayed dimensions and contain
scaling, SRT clipping/rebasing and supporting paired burn-in frames. It corrupts
only owned copied media to test source-change refusal and mixed-batch failure.
Cancellation checks actual export child exit and no owned stage/partial files,
independent parallel export success, persisted cleanup state, a fresh retry run
and immutable previous results. A failed/timeout run is never cleanup success;
inspect retained artifacts. On POSIX the runner kills its own test process group
after failure; Windows failure-process cleanup is not verified here.

## Product and packaging observations at a pinned runtime

At runtime `e8913aaa3279cb79e5726c2a3dbb6f3651834e9d`, the original local
integration harness passed in 9.35 seconds on macOS arm64 with Homebrew
`ffmpeg-full` 9.0.2_3 (upstream FFmpeg 9.0.2). Eight outputs measured exactly
1.500 or 2.000 seconds at 1080×1920@30; tone RMS was 0.088099–0.088355,
silence 0, and no-audio had no audio stream. Rotation metadata 90° measured as
360×640; the existing 2× scale cap preserves padding on that small portrait
source. Ordinary 640×360 uses scale 1.6875 and reaches both portrait frame edges.
All source mutation/partial/cancel/parallel/retry assertions above passed.

Historical failures are retained as limits: first cold FFprobe invocation on
`6f3fab3` exceeded the product's 15-second source-measurement deadline and led
to failed/storage_failed with cleanup unverified. Warming the installed binary
then passed. The first rotated fixture used an obsolete metadata-writing option
that produced no display matrix under FFmpeg 9; the assertion correctly failed.
Using `-display_rotation 90` and probing the actual matrix corrected the fixture,
without a product change. These failures are not hidden by the final pass.

At the same e8913aaa runtime, root build and unsigned macOS directory packaging
passed using `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir
--arm64 --config.mac.identity=null --publish never`. This produces a local
unsigned `.app`, not a signed installer or publication. Packaged
`licenses/AutoClip-LICENSE.txt` exactly matched `external/autoclip/LICENSE`:
SHA-256 `dac7c1396ebc3de77b3d2d9dafe396f6b6d03752ea9b74a270cb81ceea911ade`.
AutoClip 1.5.9 / `39c856b0277cd22e730002f693ca333da1f625ba` supplies the
documented shared planning integration; the upstream Python runtime is not
executed. Its full MIT notice now ships with the packaged inventory.

The packaged app.asar contains LICENSE files for all six checked SDK dependencies:
@langchain/core 1.2.3, @langchain/ollama 1.3.0, @langchain/openai 1.5.5,
@langchain/anthropic 1.5.2, @langchain/google-genai 2.2.0 and ollama 0.6.3.
Installed manifests, lock versions and MIT licenses agree. This is evidence for
these six packages, not a complete transitive-license audit. FFmpeg/FFprobe,
whisper-cli and model files were absent from app.asar/resources. The tested full
FFmpeg build reports GPL v3-or-later and enable-gpl/version3/libx264/libfreetype;
it is an explicitly selected development/system tool. Bundling it would require
a separate binary/source-obligation review, regardless of process boundaries.

No Whisper model was downloaded. The existing optional Windows installer pins
whisper.cpp b4938, binary archive SHA-256
`c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d`, and
ggml-small.bin at Hugging Face commit
`5359861c739e955e79d9a303bcbc70fb988958b1`, model SHA-256
`1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`.
Its [pinned runtime license](https://raw.githubusercontent.com/ggml-org/whisper.cpp/b4938/LICENSE)
and [pinned model card](https://huggingface.co/ggerganov/whisper.cpp/raw/5359861c739e955e79d9a303bcbc70fb988958b1/README.md)
declare MIT. The full FFmpeg formula installed a separate whisper.cpp 1.9.5_2
binary transitively in the local development environment; it is not the pinned
Windows runtime, is not configured in OpenScene and has no model here. Actual
automatic transcription and live model inference remain unverified. No mobile
development-client screen or Electron GUI flow was exercised by this harness.
