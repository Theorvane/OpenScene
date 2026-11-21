# Editor design

OpenScene edits imported media through two views of the same saved timeline.

## Timeline mode

Use the existing OpenCut presentation with a media library, Program Monitor, Inspector and multitrack timeline. The editing assistant remains in the application side panel. Panel placement, sizing and keyboard preferences belong to the current editor layout.

## Canvas mode

The header switches between Timeline and Canvas. Canvas fills the editor's central workspace with clip cards and connections. The media panel and assistant remain available. The last selected mode is stored locally.

Each video card references an existing timeline clip ID. Dragging a card changes its device-local position. Output followed by Input proposes a connection between different clips on the same video track. Applying the connection moves the target after the source, closes gaps on that track and records an undo step.

A connection preserves source ranges and speed. Keyframes move with the clip. Transitions whose endpoints are no longer adjacent are removed. Other tracks and timeline titles retain their positions.

Selecting a card's preview selects the shared clip and opens Timeline. Timeline edits and approved assistant edits update the same sequence shown on Canvas.

## Project and assistant boundaries

Opening a project leads directly to editing. Existing generation projects remain readable through the legacy project codec. The active interface offers imported media, clip editing, source analysis and export.

The assistant receives typed tools and project identities. Filesystem paths, raw FFmpeg arguments and credentials remain in the main process. Source frames carry original timestamps and are attached as images for vision-capable models. Speech is transcribed locally and its timestamped text is sent to the selected model after approval.

Project mutations require approval. Provider credentials are stored through the main process and are never rendered back. Export completion is reported from completed job state.

## Mobile

Edit, Canvas, Library and the assistant are project views. Canvas uses the shared connection rule and a compact sequence layout. Desktop frame inspection and speech analysis remain explicitly unavailable in mobile chat.
