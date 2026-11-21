# FFmpeg workflow integration

OpenScene includes a pinned MIT snapshot of kajisho5/ffmpeg-skill in .agents/skills/ffmpeg-skill. UPSTREAM.json records the upstream commit and file checksums.

Coding agents use its probe, plan, edit and verification workflow for authorized local media work. The in-app assistant receives the adapted instructions in src/shared/ffmpegEditingWorkflow.ts.

The app exposes typed editing tools. Frame inspection uses local FFmpeg to extract timestamped JPEG images. The conversation carries the actual images for multimodal review. Local whisper.cpp transcribes bounded audio ranges. Saved timeline edits and MP4 export use the existing editing pipeline.

The bundled Python tool collection remains a coding-agent skill. Originals are preserved and output inspection establishes which results can be reported as verified.

The FFmpeg source file, executable path and command arguments remain in the main process.
