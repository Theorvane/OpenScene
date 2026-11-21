# OpenScene

OpenScene is a local video editor with a timeline, a connected video canvas and a natural-language editing assistant.

## Editing

- Import video, audio and images into a project.
- Use **Timeline** for preview, trim, split, tracks, titles, effects and MP4 export.
- Use **Canvas** to connect clips and function blocks: join videos, join audio, mix audio, or combine video with audio.
- Preview a card to return to its selected clip in Timeline.
- Save and reopen the same sequence in either mode.

A canvas connection moves its target after the source and closes gaps on that video track. Other tracks and titles retain their positions. Source ranges, playback speed and clip keyframe offsets are preserved. Card coordinates are a device-local layout preference.

Use the searchable **Blocks** library to add a function. **Sources** imports media and adds source clips. Select a clip's **Output** and the block's matching video or audio input. Block outputs can feed other blocks, for example `Join videos → Video + audio ← Mix audio`. Join and mix blocks accept 2–8 inputs. **Apply block** arranges the connected clips from 0 seconds on output tracks; Timeline provides preview, undo and export. **Auto arrange** lays out the workflow and **Fit** frames it. Original video sound remains alongside added audio. Unconnected clips and titles keep their positions. Block positions and connections are saved with the project; source card positions stay local. Reusing a clip twice in one output requires duplicating it in Timeline first.

Project settings, panel controls and appearance live in separate menus. Open **Assistant** when needed. See the [menu tree and layout](docs/editor-menu-layout.md).

## Editing assistant

The desktop assistant can inspect source frames, transcribe a selected audio range, edit clips and start export. Vision-capable models receive actual timestamped JPEG images. Detailed frame review samples one image per second for up to 20 seconds at a time. Speech inspection uses local FFmpeg and whisper.cpp. Review the requested operation before approving a project edit or transcript inspection.

Connect a chat provider in Settings or configure a local Ollama model. Requests to a connected model may send the frames, transcript and project context selected for that operation.

## Run from source

Use Node.js 22 or newer and initialize the pinned OpenCut submodule.

```sh
git submodule update --init
npm ci
npm run dev
```

FFmpeg is required for export and source analysis. The Windows setup executable installs it through WinGet when no existing copy is found. Other packages and source builds use FFmpeg from PATH or an absolute VIDEO_TOOL_FFMPEG_PATH.

For local speech transcription, run npm run setup:transcription. The setup script downloads pinned whisper.cpp binaries and a model into ignored local storage and verifies their checksums. Explicit runtime settings are listed in .env.example.

## Verify

```sh
npm run typecheck
npm test
npm run build
cd mobile
npm ci
npm run typecheck
```

The build command creates application output. Use npm run package for desktop packages.

The [Linux media-analysis environment](docs/media-analysis-environment.md) runs FFprobe-dependent tests and REA without changing Windows application-control settings. With Docker Desktop running, use `npm run verify:media-analysis`; add `-- -AnalyzeEditor` to analyze the current `out/` build. It verifies a Git snapshot with separate Linux dependencies.

## Project compatibility

Projects created by earlier versions retain their imported media and saved timeline. Legacy AI metadata is decoded to preserve project readability. New media generation, production boards and generation provider automation have been removed.

The mobile app provides Edit, Canvas, Library and the editing assistant. Mobile Canvas uses the same four function blocks and connection rules in a compact touch layout. Frame and speech inspection through chat are desktop capabilities.

## Architecture

- src/main owns filesystem access, credentials, FFmpeg, transcription and editing tools.
- src/preload exposes the typed window.videoTool bridge.
- src/renderer owns the desktop interface.
- src/shared contains editing rules and project codecs shared with mobile.
- external/opencut supplies pinned editor presentation components.

See [editor design](DESIGN.md), [OpenCut integration](docs/opencut-integration.md), [assistant boundaries](docs/hybrid-ai-editor-direction.md) and [FFmpeg workflow](docs/ffmpeg-skill-integration.md).

OpenScene and the pinned OpenCut source use MIT licenses. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Usage reporting

The mobile app reports anonymous usage counts. Settings provides a switch to turn reporting off. Event properties are limited to numbers, booleans and null, and do not contain prompts, media paths or credentials.
