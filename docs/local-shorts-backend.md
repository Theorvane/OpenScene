# Local multi-shorts backend MVP

One video already imported into a local project can produce independently editable short projects. The source project and source file are never edited. Desktop IPC is the entry point; this change adds no mobile screen, URL ingestion, upstream AutoClip service, model installer, publishing or subject-tracking crop.

## Contract and ownership

`src/shared/shortsTypes.ts` defines the path-free bridge DTOs; `shortsCandidateSelection.ts` owns evidence selection and validation; `shortsRecipe.ts` builds fresh timelines through the existing AutoClip edit planner and editor batch rules. `src/main/shortsService.ts` orchestrates stores, existing transcription and existing export. The configured model factory and `shortsCandidateProvider.ts` supply the selection provider without edit tools or separate credentials.

All source/caption/candidate times are exact safe integer milliseconds, with `0 <= start < end <= measured source duration`. Only the AutoClip planning boundary converts milliseconds to source seconds. Output inspection may use `max(100 ms, 2 frames)` of tolerance; validation never uses that tolerance to accept out-of-source ranges.

| Bridge method | Input | Successful value |
| --- | --- | --- |
| `shortsStart` | `ShortsStartInput`: project/asset/model IDs, existing auth/model options, optional count/duration limits | New `ShortsJob` |
| `shortsGet` | `{jobId}` | Current `ShortsJob` |
| `shortsList` | `{projectId}` | Saved runs, including recipes, caption previews and result references |
| `shortsCancel` | `{jobId}` | `{accepted}`; this is not cleanup completion |
| `shortsMaterialize` | `{jobId,candidateIds}` | Updated job; explicit approval of candidate ranges and transcript captions |
| `shortsExport` | `{jobId,resultProjectIds}` | A **new** export run with `parentJobId`, including on retry |

Default requested count is four (one to five), with 15–60 second candidates. Tests may override duration limits for short synthetic sources. The provider chooses existing evidence boundary IDs, never numeric timestamps. The core derives ranges, rejects unknown citations and malformed output, suppresses duplicate/overlapping passages and omits incomplete thoughts. Insufficient evidence is a normal review result with fewer or zero candidates. Invalid provider output, provider failure, missing configuration and cancellation are distinct outcomes.

The MVP assembles transcript evidence. It reuses the source project's transcript if present, otherwise automatically starts the existing local whisper.cpp job. Progress is exposed under `transcription`; missing runtime produces `transcription_not_configured`, and transcription failure produces `transcription_failed`. No transcript is fabricated for silent or non-speech video. The core accepts scene clues for a future measured adapter, but this desktop orchestration does not invent or auto-generate scene descriptions.

## Review and output

Candidate selection is renderer state until `shortsMaterialize`. Caption previews use **original source milliseconds**, including after a trim is proposed. Each approved candidate gets a new internal project with its own verified source copy. SHA-256 in the recipe binds the selected source to the copied result; a changed source is refused and the incomplete project is removed. Caption cues are clipped and rebased through `applyTranscriptionCues`. The normal project editor and save APIs are the single path for subsequent trim, title/caption or supported framing edits.

Recipes record version, source project/asset/duration/hash, candidate/evidence IDs/reason/context, relevant original caption evidence and 1080×1920 at 30 fps with contain fit. Contain preserves the source picture inside a portrait frame; it does not track a person or assert a semantic crop. Export reads each saved result project, so user edits are honored. FFmpeg output and provenance naming remain owned by the existing export service, using unique export job IDs. Successful outputs are retained through partial failures. A retry selects result project IDs into another export run; previous success files are never replaced.

The real compiler uses `drawtext` only when the saved export timeline has titles/captions. Existing title/font checks reject unsupported builds; the `subtitles` filter is not required. Encoder preflight reads the actual compiled command: `libx264`, plus `aac` only when audio is mapped. Capability failures are returned on the individual item with an actionable configuration message. Custom injected export executors own their runtime capability contract.

## Lifecycle and persistence

Jobs/recipes are saved under local `userData/shorts-jobs` using serialized temporary-file rename publication. Responses expose opaque IDs and safe status/errors, never paths, FFmpeg arguments, credentials or raw provider errors. Existing project import uses create-new copy verification; incomplete output projects are deleted after a failed or cancelled copy/save. Completed editable projects remain available.

Cancellation sets `cancelling` and aborts owned work. `cleanupComplete` becomes true only after the provider promise, transcription process/input handle, current asset copy and owned export process/staging cleanup have settled. A cancelled export job state alone is insufficient. The configured provider transport receives the signal and a 30 second request deadline. Graceful application shutdown aborts active shorts work and awaits settlement. Hard crashes cannot promise cleanup: saved nonterminal jobs reopen as `failed`/`interrupted` with `cleanupComplete:false`, without resuming or deleting arbitrary retained output. Review retained files and start a new run.

## Reused components and licenses

No dependency, binary or model is added by this feature. It calls these existing production paths:

| Component / existing pin | Product use | Provenance and redistribution boundary |
| --- | --- | --- |
| OpenScene `planAutoClipEdit` / atomic editor operations | Convert validated source ranges to editable clips | Application MIT `LICENSE`; the separately pinned AutoClip 1.5.9 source at `39c856b0277cd22e730002f693ca333da1f625ba` is **not executed** by this workflow; its MIT text remains `external/autoclip/LICENSE` and `THIRD_PARTY_NOTICES.md` |
| User-configured/system FFmpeg + matching FFprobe | Measure source, render saved portrait timelines, inspect results | Executable/build version varies by installation; binary, codec and transitive build obligations must be assessed for that exact build. This PR redistributes none. Existing `THIRD_PARTY_NOTICES.md` describes the system-runtime boundary; this does not waive GPL/LGPL obligations for future bundled builds |
| Existing whisper.cpp runtime, optional setup pin `b4938`; `ggml-small.bin` model commit `5359861c739e955e79d9a303bcbc70fb988958b1` | Automatic local transcript when absent | Existing installer records binary/model SHA-256; user must configure runtime/model. No installer or model download is run by shortsStart or this PR. Preserve runtime/model license/provenance if separately distributed |
| Lockfile: `@langchain/core` 1.2.3, `@langchain/ollama` 1.3.0, `@langchain/openai` 1.5.5, `@langchain/anthropic` 1.5.2, `@langchain/google-genai` 2.2.0, `ollama` 0.6.3 | Existing selected authorized model, strict JSON evidence proposals, abortable local transport | Existing MIT package LICENSE files and `THIRD_PARTY_NOTICES.md` LangChain inventory; no replacement model weights or provider account introduced |

The package build is not an installer/release verification. Exact FFmpeg build/license evidence and actual media smoke results belong in the verification report, alongside the tested commit SHA. Deterministic HTTP fixtures establish wiring and transport behavior; they do not establish real inference quality. Synthetic transcript fixtures establish timing and export mechanics; they do not establish speech-recognition accuracy.
