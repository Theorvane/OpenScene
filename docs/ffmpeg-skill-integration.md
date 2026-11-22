# FFmpeg workflow integration

OpenScene includes the MIT skill through the pinned `external/ffmpeg-skill` Git submodule, from https://github.com/Theorvane/ffmpeg-skill.git, just like `external/opencut`. Initialize both with `git submodule update --init --recursive`. The discoverable `.agents/skills/ffmpeg-skill/SKILL.md` adapter points to the complete external skill. Its `UPSTREAM.json` records the revision and source-file checksums; tools are not duplicated in the adapter directory.

The organization maintains [Theorvane/ffmpeg-skill](https://github.com/Theorvane/ffmpeg-skill), forked from [kajisho5/ffmpeg-skill](https://github.com/kajisho5/ffmpeg-skill). Use the organization fork for OpenScene-specific fixes and reviewed submodule updates. `UPSTREAM.json.managedFork` identifies that maintenance source; `repository`, `commit`, and checksums retain the pinned source's provenance. This migration preserves reviewed commit `3145261a1c19f399b9520fad7fdac741871e1426` (3.13.1); fork main is not silently adopted. For an upgrade, review the fork diff, run its checks and OpenScene integration tests, then update the gitlink, manifest and pins together.

Coding agents use its probe, plan, edit and verification workflow for authorized local media work. The in-app assistant receives the adapted instructions in src/shared/ffmpegEditingWorkflow.ts.

The app exposes typed editing tools. Frame inspection uses local FFmpeg to extract timestamped JPEG images. The conversation carries the actual images for multimodal review. Local whisper.cpp transcribes bounded audio ranges. Saved timeline edits and MP4 export use the existing editing pipeline.

The app's editing agent discovers its implemented blocks and batch operations through `getEditingCapabilities` and inspects graphs through `getCanvasWorkflow`. `editProject` applies shared canvas, layout and timeline edits atomically. This does not dynamically expose all bundled Python scripts as chat tools. Mobile uses the same editing rules with native export; desktop frame/speech inspection has no mobile chat equivalent.

The bundled Python tool collection remains a coding-agent skill. Originals are preserved and output inspection establishes which results can be reported as verified.

The FFmpeg source file, executable path and command arguments remain in the main process.

Canvas processing is evaluated before export: settings become a timeline only when applied. Desktop FFmpeg compiles the saved sequence, including source ranges, speed, delay, audio mixing, effects and typography. Original files remain intact. Output verification measures the produced MP4; frame and audio inspection provide additional evidence beyond container metadata.

For a visual request, a silent source or empty transcript still requires images. Read source timecodes and account for clip placement/speed when editing. A successful job launch is not completion. See [agent boundaries](hybrid-ai-editor-direction.md), [canvas workflows](canvas-workflows.md) and [Linux verification setup](media-analysis-environment.md).
