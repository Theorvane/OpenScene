# OpenScene editor design

OpenScene edits supplied media through two views of the same saved timeline, with an agent that can operate on both. The primary workflow is import → assemble → refine → review → export.

## Timeline mode

The Timeline / Canvas switch changes the project's editing surface. Timeline contains a media dock, Program Monitor, Inspector and multitrack timeline. OpenCut presentation components are hosted by OpenScene's controller; playback, edits, saves and export use OpenScene's shared model.

The Inspector groups clip editing, video appearance, audio and text controls. It supports trimming/splitting, speed, duplication, transitions, colour, transforms, opacity, audio level and separation, plus title/caption typography. Font family and weight, shadow, outline, background and placement are persisted settings. Preview remains best-effort; final delivery is the rendered output.

Windows menus share theme tokens and editor command state. Project, View and Appearance separate project settings from workspace and theme preferences. Assistant is a collapsible app panel. See the [menu tree](docs/editor-menu-layout.md).

## Canvas mode

Canvas fills the workspace with a library and graph. The library starts with **Quick starts**, followed by **Blocks** and **Sources**. Sources imports media and places source clips; cards reference clip IDs. Source selection controls quick-start inputs and node arrangement.

The shared catalog contains 12 blocks. Four quick starts connect useful combinations automatically. Input dropdowns offer valid typed connections without requiring wire dragging. Selecting an output followed by an input remains available. Invalid types and cycles are refused. Incomplete branches display missing inputs.

The toolbar selects a final output, applies its workflow and opens Timeline review. **Apply workflow** changes timeline tracks; changing settings alone changes the graph. **Apply block** supports an intermediate branch. No graph change automatically renders media.

### Processing semantics

- Sequential blocks concatenate inputs; a mix layers them; video/audio composition combines their lanes.
- Trim, speed, delay and volume process video, audio or combined branches. Picture operations accepting combined input preserve separate audio lanes.
- Picture in picture places its inset above its background. Muting video sound preserves separate audio.
- Processing captures original input ranges in optional graph metadata. Reapplication evaluates those inputs instead of compounding effects on the processed result.
- **Refresh inputs** adopts the current timeline as fresh input. It is explicit and undoable.
- Apply consumes all branch sources, including clips removed entirely by a trim. Unrelated clips and titles retain their positions. Invalidated transitions are removed.
- A source clip can appear once per final output. Duplicate it in Timeline for repeated use.

The [workflow guide](docs/canvas-workflows.md) specifies blocks, settings and limits.

### Node layout

Source and block positions are saved with the project. Existing device-local source positions remain a fallback until saved graph positions are available. Moving a node changes layout independently of clip timing.

**Auto arrange** follows input-to-output dependencies. **Arrange nodes** offers flow, grid, left/top alignment and horizontal/vertical spacing. Source and block checkboxes choose targets; an empty selection uses all nodes. Layout preserves connections and media, participates in Undo/Redo, and rejects arrangements beyond canvas bounds. **Fit**, zoom and scrolling control the desktop viewport.

## Agent editing

The agent discovers blocks and operation fields, reads the project and graph, then proposes a bounded batch. All 34 operations use shared editing rules. Each intermediate document is validated; saving occurs only when the whole batch succeeds. Saved mutations notify open desktop editors.

Desktop inspection attaches timestamped source images to a multimodal model. Local transcription supplies speech with source timecodes. Empty speech is not evidence of an empty picture: visual requests still require frames. The agent distinguishes source time from timeline time and checks job results before reporting completion.

Read-only capabilities are explicit. Mutations and jobs follow approval gates. The host saves pending timeline edits before agent execution. Paths, credentials and raw FFmpeg arguments stay in main. See [agent boundaries](docs/hybrid-ai-editor-direction.md).

## Export

Export renders the saved timeline, including applied graph results. Desktop uses FFmpeg MP4 output with frame, caption-delivery and metadata-privacy settings. Completion and verification are distinct: a created job is pending, a completed file can be unmeasured, and a measured file can fail review.

Native FFprobe is preferred. Windows can use a prepared local Linux container when native probing cannot start, or select that runtime explicitly. The app does not provision Docker or download its image. See [verification setup](docs/media-analysis-environment.md).

## Mobile

Edit, Canvas, Library and Assistant share the core. Mobile Canvas exposes quick starts, blocks, typed connections, settings, final-output application and saved layout operations in a touch layout. Its agent uses shared batch edits and native export after approval.

Mobile uses native composition/export. Free-position cards, viewport Fit and chat-based frame/speech inspection remain desktop capabilities. Mobile changes require development-client checks; desktop tests do not establish device behavior.

## Compatibility

Optional graph metadata extends the timeline document. Projects without it still open. Legacy AI fields remain codec-preserved data; they do not enable a generation workspace. Storage keys, public identifiers and submodule pins retain their compatibility meaning.
