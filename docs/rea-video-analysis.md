# Local measured shot analysis

This initial OpenScene adapter provides cancellable local cut-candidate measurement,
a shot-range review table, a manual recreation checklist, a downloadable `VIDEO.md`,
and a batch of existing `clip.add` operations for reviewed original ranges. It does
not execute rea-video's Python analysis, semantic classification, speech recognition,
prompt reconstruction, generation, or rendering. Original ranges are never labeled
as generated media. This Markdown is deliberately **not** advertised as a complete,
validated upstream VIDEO.md package.

The dedicated desktop component `ReaVideoAnalysisWorkspace` takes the open project's
assets, target video track, insertion position, `sourceEpoch`, and `onImportOperations`. That callback
must use the normal editor transaction/history boundary, preserving dirty state and
Undo; the component and analysis service never save a project. The existing asset
library resolves the source in main. App/AppShell/TimelineEditor host mounting belongs
to FE576 and is reserved for that owner after its merge. No mobile UI is added in this
desktop backend scope, as explicitly directed by the coordinator. Mobile cannot spawn
this desktop subprocess adapter. The component is not a navigation entry by itself.

## Exact upstream audit

Audited official repository: https://github.com/JuneYaooo/rea-video at
`c11f1bd8fd3edd26a40e8f45be828be685417700`. Sources read: README, pyproject,
shots.py, pipeline.py, videomd.py, stems.py, generation.py and the capsule-cinema
integration. README explicitly says rea-video does not render a video; it analyzes
production methods and plans recreations. Capsule-cinema is a separate integration.
No provider support or cost is inferred from its marketing or capability tables.

Only upstream attribution and dependency-audit resources are included in
`resources/rea-video/`: byte-identical LICENSE (Apache License 2.0), NOTICE
(`Copyright 2026 JuneYaooo`), and pyproject.toml. `UPSTREAM.json` records exact SHA-256
and byte sizes; tests verify them. No upstream Python implementation, models, sample
media, or capability tables are bundled. OpenScene's FFmpeg adapter is new TypeScript,
not a claim that the upstream forensic pipeline has been ported or installed.

## Dependencies and distribution boundary

Upstream requires Python >=3.10, FFmpeg, numpy >=1.24,<3,
opencv-python-headless >=4.8,<5, Pillow >=9, PyYAML >=6, videomd >=1.2,
and onnxruntime >=1.16. Optional OCR selects rapidocr-onnxruntime or rapidocr by
Python version; ASR uses sherpa-onnx. Versions are ranges, not a locked dependency
closure. The upstream project's Apache license **does not establish licenses for
these transitive packages, model weights, or FFmpeg builds**. Their exact releases,
notices and redistribution obligations remain unreviewed and are not redistributed here.

Upstream describes automatic first-use UVR MDX-Net (~67 MB), BandIt v2 (~149 MB),
SenseVoice (~160 MB) and speaker (~35 MB) downloads. README states BandIt weights
are CC BY-SA 4.0; UVR weights and every other unreviewed weight must not be assumed
Apache licensed. We do not call those paths, install Python packages, download
models, contact providers or upload user media. No GPU is required for this adapter.
Future upstream execution needs an exact dependency/model manifest, host/byte/cost
disclosure and explicit approval before installation or execution.

The adapter discovers FFmpeg through existing `VIDEO_TOOL_FFMPEG_PATH`/PATH rules
and requires ffprobe beside its resolved binary. It never ships a new FFmpeg binary;
an externally supplied build's LGPL/GPL/nonfree configuration and codec/patent
distribution obligations cannot be decided from its executable name. Python is
diagnostic only: `VIDEO_TOOL_REA_PYTHON_PATH` or absolute PATH directories, `--version`
only, >=3.10 reported compatible; the upstream pipeline remains unavailable even
when Python is compatible. Local measured analysis works without Python.

## Resource and trust boundaries

One concurrent job; eight retained jobs per app process; no automatic resume. Input
must be an imported video, <=2 GiB, <=10 minutes, <=3840x2160 pixels in area and
<=3840 pixels on either dimension (portrait included). Analysis scales to
320px width, uses one decoder/filter thread, a fixed 0.35 scene threshold and at
most 60 ranges. A larger/too-busy input fails rather than silently truncating.
Buffers are capped at 256 KiB combined stdout/stderr; probe timeout is 15 seconds,
analysis timeout 120 seconds; allocations are capped individually at 64 MiB (this
is not an operating-system total-memory limit). No shell/stdin, no renderer paths
or argv, file-only protocol and a closed container list exclude remote playlists.
FFmpeg children receive TERM then KILL after 500 ms; completion/cleanup is reported
only after process close. App shutdown awaits cancellation. FFmpeg is launched
directly, without a shell or helper process tree. No analysis temporary files or
derived media are created, so cancellation retains no partial files. VIDEO.md is
downloaded only on explicit action; job metadata is in memory and disappears on exit.

The result includes only opaque project/asset/job/shot ids, timings, fixed capability
labels and sanitized error codes. Detailed child diagnostics, paths and Python
locations do not cross IPC. Semantic inspection and generation are distinct future
stages; current generation is `unavailable-implementation-missing` and
`paidExecutionAllowed: false`. Future generation should resolve a separately
approved provider using the existing `VideoGenerationProvider.createJob(request)`
and `getJob(jobId)` contract only after official API/auth/upload/cost auditing.

## Verification

`tests/reaVideoAnalysis.test.ts` checks strict input DTOs, resource bounds, sanitized
IPC failures, runtime absence, child cancellation/timeouts/output caps, exact upstream
resource hashes, and reviewed range roundtrip through the existing atomic editor.
A tiny real FFmpeg black/white fixture verifies the measured 1-second cut, source
preservation, corrupt input failure, and cancellation cleanup without external media.
Renderer QA mounts the dedicated component with a mock bridge and exercises review,
import callbacks and rejection of a delayed response after switching projects. Host
navigation must be verified by its integration owner before claiming a shipped user entry point.

## Host integration contract

Import `ReaVideoAnalysisWorkspace` from
`src/renderer/components/workspace/ReaVideoAnalysisWorkspace.tsx` (named export).
Props: `projectId`, `assets`, `trackId`, `atMs`, `sourceEpoch: string`,
`onImportOperations(operations, { projectId, sourceEpoch, trackId, atMs }): void`.
The host increments the source epoch on project/source replacement, deletion or
reload. It checks the callback's context against the live editor and dispatches the
whole batch through the normal atomic edit/history function exactly once; no direct
save and no direct timeline mutation. Deleted targets are rejected by the ordinary
`clip.add` validator. Changing project/source cancels the prior job; late start/import
responses cannot populate the new project or invoke its callback. Track/placement
changes during preparation invalidate that import response.

Preload methods: `reaAnalysisRuntime()`, `reaAnalysisStart({projectId,assetId})`,
`reaAnalysisGet({jobId})`, `reaAnalysisCancel({jobId})`, and
`reaAnalysisPrepareImport({projectId,assetId,jobId,shotIds,trackId,prefix,atMs})`.
All return existing `ApiResponse<T>`. Preparation accepts no arbitrary operations;
main checks reviewed status, source scope, exact selected shot ids, source existence
and measured file size/mtime before producing only `clip.add` operations. Cancellation
invalidates review plans. File identity checks detect normal replacement, not adversarial
same-size/mtime tampering. Errors are fixed sanitized messages/codes. Operation validation
and host context checking remain required at application time; preparation does not save
or reserve the live timeline and cannot authorize later application in a different editor.
