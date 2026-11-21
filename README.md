# OpenScene

OpenScene is a local video editor that combines a multitrack timeline, a node canvas and an editing agent. Import footage, build an edit visually or describe it in natural language, then review and export the same project.

## One project, three ways to edit

| Surface | Use it for |
| --- | --- |
| **Timeline** | Preview, trim, split, arrange tracks, adjust effects, and style titles and captions. |
| **Canvas** | Connect processing blocks, combine video and audio, and apply a workflow to the timeline. |
| **Assistant** | Inspect footage, discover editing operations, and propose approved changes to clips, blocks and connections. |

Timeline is the sequence used for playback and export. Canvas stores a workflow alongside it; **Apply workflow** materializes its result into timeline tracks. Changing a node does not start a render.

## Start editing

1. Create or open a project and import video, audio or images.
2. Arrange clips in **Timeline**, or switch to **Canvas** and choose a quick start.
3. Adjust inputs and settings. Use input dropdowns or select an output followed by a matching input.
4. Choose the final output and click **Apply workflow**. Use **Review timeline** to check the cut.
5. Save, then **Export** an MP4. Check the completed export's verification result.

### Canvas workflows

Quick starts include **Quick highlight**, **Video with music**, **Picture in picture**, and **Voice and music mix**. Select source cards to choose inputs; an empty selection uses matching sources in timeline order.

There are 12 block types: join videos, join audio, mix audio, combine video and audio, trim a range, change speed, delay a branch, apply a colour look, set volume, transform the picture, picture in picture, and mute embedded video sound.

**Auto arrange** places inputs before dependent blocks. **Arrange nodes** also offers a grid, left/top alignment and horizontal/vertical spacing for selected nodes or the whole graph. Positions and connections are saved with the project and can be undone. **Fit** frames the workflow.

Processing preserves original input ranges so repeated application does not compound trimming or speed changes. **Refresh inputs** deliberately replaces those inputs with the current timeline. Original media files are preserved. See [canvas workflows](docs/canvas-workflows.md) for parameters and connection rules.

### Timeline controls

Use the media library, Program Monitor, timeline and Inspector to refine the result. Controls include clip speed and colour, position/scale/rotation/opacity, audio volume and track mixing, transitions, keyframes, and titles/captions with font, outline, background and shadow settings.

Windows uses app-styled **File / Edit / Clip / View / Timeline / Workspace / Help** menus. Project settings, panel visibility and appearance have separate controls. Open Assistant when needed. See [menus and layout](docs/editor-menu-layout.md).

### Editing agent

The agent can discover 34 batch editing operations covering blocks, connections, templates, node layout, clips, tracks, effects, keyframes, typography, captions and transitions. It uses the editor's shared rules. A rejected batch saves no partial changes. Project edits and jobs follow the app's approval gates.

Desktop source inspection supplies timestamped JPEG images to vision-capable models and local speech transcription through FFmpeg and whisper.cpp. For a visual request, silent audio or an empty transcript still requires frame inspection. Detailed review samples one image per second over a window of up to 20 seconds.

Connect a supported chat provider in Settings or configure a local Ollama model. Selected context, images and transcripts may be sent to the chosen model; provider charges belong to your account. A started job is not proof of a finished or verified export. See [agent capabilities and boundaries](docs/hybrid-ai-editor-direction.md).

## Run from source

Use Node.js 22 or newer and initialize the pinned OpenCut submodule.

```sh
git submodule update --init external/opencut
npm ci
npm run dev
```

FFmpeg is required for desktop export and source analysis. The Windows setup executable installs it through WinGet when no existing copy is found. Other packages and source builds use `ffmpeg` on `PATH` or an absolute `VIDEO_TOOL_FFMPEG_PATH`.

For local transcription, explicitly run `npm run setup:transcription`. This downloads pinned whisper.cpp binaries and a model into ignored local storage and verifies checksums. See [.env.example](.env.example) for runtime settings.

`npm run build` creates application output; `npm run package` creates desktop packages. See [contributing](CONTRIBUTING.md) for branch conventions.

## Verify

```sh
npm run typecheck
npm test
npm run build
cd mobile
npm ci
npm run typecheck
```

Media tests need executable FFmpeg and FFprobe. The [Linux verification environment](docs/media-analysis-environment.md) runs the full suite and both surfaces' type checks using a committed Git snapshot and separate dependencies. With Docker Desktop running, use `npm run verify:media-analysis`; add `-- -AnalyzeEditor` for optional current-build analysis.

[Latest recorded workflow verification](docs/canvas-export-verification.md): actual Windows canvas editing and agent-tool export, Linux FFprobe verification, and 1,191 Linux tests passing with no failures or skips at commit `88c6ecf`. This is that revision's result; run checks for subsequent changes.

## Mobile

Mobile provides **Edit**, **Canvas**, **Library** and an editing assistant over the shared core. It includes the same block catalog, quick starts and batch operations. Its touch canvas edits connections and saved layout settings; free-position cards and Fit are desktop controls. Chat-based frame inspection and speech analysis are desktop capabilities.

Mobile rendering uses native AVFoundation/Media3 modules and needs a development build; Expo Go cannot load the exporter. See the [mobile guide](mobile/README.md). Desktop verification does not establish mobile device behavior.

## Local storage and compatibility

Projects, imported media and desktop exports remain on the device. Model requests are explicit network operations. Mobile reports anonymous usage counts to the publisher's OpenPanel instance; Settings provides an off switch. Event properties are limited to numbers, booleans and null, excluding prompts, media paths and credentials.

Earlier projects retain their assets, timelines and legacy metadata. The current product edits supplied media; video generation, production boards and voice synthesis are not active workflows. Compatibility identifiers remain stable.

## Documentation

Start with the [documentation index](docs/README.md), [editor design](DESIGN.md), [shared project architecture](docs/architecture/editor-project.md), [OpenCut integration](docs/opencut-integration.md), and [FFmpeg integration](docs/ffmpeg-skill-integration.md).

OpenScene and its pinned OpenCut source use MIT licenses. See [third-party notices](THIRD_PARTY_NOTICES.md).
