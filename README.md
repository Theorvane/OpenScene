# OpenScene

OpenScene is a natural-language video editor. Describe what you want, review the result, and refine it with timeline and node-based editing.

자연어로 영상을 만들고 다듬는 영상 편집 도구.

Start with your own local video files. One core workflow turns an imported video into multiple reviewable shorts: choose a configured model, review the proposed source ranges and captions, approve editable result projects, then refine and batch export the saved results. Candidate selection depends on transcript evidence and can return fewer clips or none. This edits supplied footage; it does not generate source video from a prompt.

## One project, three ways to edit

| Step | Use it for |
| --- | --- |
| **1. Describe in natural language** | Tell Assistant the edit you want; inspect its proposal and approve changes using the shared editing operations. |
| **2. Refine on Timeline** | Review the result, trim and split clips, arrange tracks, adjust effects, and style titles and captions. |
| **3. Shape a node workflow** | Connect Canvas blocks or use quick-start recipes, adjust their parameters, and apply the result to Timeline. |

Timeline is the sequence used for playback and export. Canvas already supports saved node graphs, four quick starts and 12 processing blocks; **Apply workflow** materializes a branch into timeline tracks. Changing a node does not start a render. Quick-start recipes are fixed starting configurations, not automatic semantic highlight detection or a general recipe marketplace.

The desktop **Shorts** workspace provides candidate review, editable result projects and batch export. Results use portrait framing with contain fit; automatic subject tracking is not implemented. Model quality requires separate validation. Active development targets the desktop app; mobile support is deferred. See [current shorts scope](docs/local-shorts-backend.md) and [recorded verification limits](docs/shorts-media-validation.md).

**Roadmap:** app-window computer-use automation (CUA) and Jev integration are separate work in progress, not capabilities promised by this introduction. Existing node editing and quick starts are available now; broader reusable recipe workflows remain a product direction.

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
git -c core.autocrlf=false submodule update --init --recursive
npm ci
npm run dev
```

FFmpeg is required for desktop export and source analysis. The Windows setup executable installs it through WinGet when no existing copy is found. Other packages and source builds use `ffmpeg` on `PATH` or an absolute `VIDEO_TOOL_FFMPEG_PATH`.

Keep the pinned skill submodule's original line endings when initializing on Windows; its manifest verifies exact bytes. The command above initializes both OpenCut and the FFmpeg skill without CRLF conversion.

For local transcription, explicitly run `npm run setup:transcription`. This downloads pinned whisper.cpp binaries and a model into ignored local storage and verifies checksums. See [.env.example](.env.example) for runtime settings.

`npm run build` creates application output; `npm run package` creates desktop packages. See [contributing](CONTRIBUTING.md) for branch conventions.

## Verify

```sh
npm run typecheck
npm test
npm run build
```

Media tests need executable FFmpeg and FFprobe. The [Linux verification environment](docs/media-analysis-environment.md) runs the full suite and desktop type checks using a committed Git snapshot and separate dependencies. With Docker Desktop running, use `npm run verify:media-analysis`; add `-- -AnalyzeEditor` for optional current-build analysis.

[Latest recorded workflow verification](docs/canvas-export-verification.md): actual Windows canvas editing and agent-tool export, Linux FFprobe verification, and 1,191 Linux tests passing with no failures or skips at commit `1d68304`. This is that revision's result; run checks for subsequent changes.

## Platform scope

OpenScene currently focuses on desktop: macOS, Windows and Linux. Mobile implementation and mobile release automation are suspended; mobile support may be reconsidered later. See [desktop-first scope](docs/desktop-focus.md).

## Local storage and compatibility

Projects, imported media and desktop exports remain on the device. Model requests are explicit network operations.

Earlier projects retain their assets, timelines and legacy metadata. The current product edits supplied media; video generation, production boards and voice synthesis are not active workflows. Compatibility identifiers remain stable.

## Documentation

Start with the [documentation index](docs/README.md), [editor design](DESIGN.md), [shared project architecture](docs/architecture/editor-project.md), [OpenCut integration](docs/opencut-integration.md), and [FFmpeg integration](docs/ffmpeg-skill-integration.md).

OpenScene and its pinned OpenCut source use MIT licenses. See [third-party notices](THIRD_PARTY_NOTICES.md).
