# FFmpeg workflow integration

OpenScene includes a pinned MIT snapshot of kajisho5/ffmpeg-skill in .agents/skills/ffmpeg-skill. UPSTREAM.json records the upstream commit and file checksums.

The organization maintains [Theorvane/ffmpeg-skill](https://github.com/Theorvane/ffmpeg-skill), forked from [kajisho5/ffmpeg-skill](https://github.com/kajisho5/ffmpeg-skill). Use the organization fork for OpenScene-specific fixes and reviewed snapshot updates. `UPSTREAM.json.managedFork` identifies that maintenance source; `repository`, `commit`, and checksums retain the original snapshot's provenance. Creating the fork does not upgrade the bundled 3.13.1 snapshot to a different release.

Coding agents use its probe, plan, edit and verification workflow for authorized local media work. The in-app assistant receives the adapted instructions in src/shared/ffmpegEditingWorkflow.ts.

The app exposes typed editing tools. Frame inspection uses local FFmpeg to extract timestamped JPEG images. The conversation carries the actual images for multimodal review. Local whisper.cpp transcribes bounded audio ranges. Saved timeline edits and MP4 export use the existing editing pipeline.

The bundled Python tool collection remains a coding-agent skill. Originals are preserved and output inspection establishes which results can be reported as verified.

The FFmpeg source file, executable path and command arguments remain in the main process.
