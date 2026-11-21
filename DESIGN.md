# Editor design

OpenScene edits imported media through two views of the same saved timeline.

## Timeline mode

Use the existing OpenCut presentation with a media library, Program Monitor, Inspector and multitrack timeline. The editing assistant remains in the application side panel. Panel placement, sizing and keyboard preferences belong to the current editor layout.

## Canvas mode

The header switches between Timeline and Canvas. Canvas fills the editor workspace with a searchable Blocks / Sources library and a graph. Sources handles media imports and clip placement. Auto arrange follows source → processing → composition dependencies, and Fit frames the workflow. Assistant opens from application chrome when needed. The last selected mode and existing panel preferences are stored locally. See the [menu tree and layout](docs/editor-menu-layout.md).

Each video card references an existing timeline clip ID. Dragging a card changes its device-local position. Output followed by Input proposes a connection between different clips on the same video track. Applying the connection moves the target after the source, closes gaps on that track and records an undo step.

A connection preserves source ranges and speed. Keyframes move with the clip. Transitions whose endpoints are no longer adjacent are removed. Other tracks and timeline titles retain their positions.

Selecting a card's preview selects the shared clip and opens Timeline. Timeline edits and approved assistant edits update the same sequence shown on Canvas.

Function blocks follow the typed input/output approach of [ComfyUI](https://github.com/Comfy-Org/ComfyUI). Join videos, Join audio and Mix audio accept 2–8 matching inputs; Video + audio accepts one video and one audio input. Blocks can be chained. Audio connections use a distinct color. Missing inputs, incompatible media, cycles and duplicate source use are rejected before applying. Disconnect, remove and add-input controls keep graph editing explicit.

The shared evaluator resolves clips, playback speed, source ranges and keyframe offsets into lanes. Apply moves connected clips into output tracks starting at zero, retaining audio gain, pan and mute per lane. Other clips and titles keep their positions; invalidated transitions are dropped. Video sound remains enabled. Applying does not rewrite source files. Blocks, their positions and edges are optional timeline metadata and participate in save and undo; source card coordinates remain local. Older timelines without graph metadata continue to open.

## Project and assistant boundaries

Opening a project leads directly to editing. Existing generation projects remain readable through the legacy project codec. The active interface offers imported media, clip editing, source analysis and export.

The assistant receives typed tools and project identities. Filesystem paths, raw FFmpeg arguments and credentials remain in the main process. Source frames carry original timestamps and are attached as images for vision-capable models. Speech is transcribed locally and its timestamped text is sent to the selected model after approval.

Project mutations require approval. Provider credentials are stored through the main process and are never rendered back. Export completion is reported from completed job state.

## Mobile

Edit, Canvas, Library and the assistant are project views. Canvas separates Workflow / Sources / Blocks and uses the shared catalog and evaluator, including typed connections, input expansion, disconnect, removal, apply and undo. Free card positioning remains desktop-only. Desktop frame inspection and speech analysis remain explicitly unavailable in mobile chat.
