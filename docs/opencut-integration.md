# OpenCut presentation integration

OpenScene uses the MIT-licensed [Theorvane/OpenCut](https://github.com/Theorvane/OpenCut) fork at `external/opencut` as a pinned Git submodule. Initialize it with `git submodule update --init external/opencut`. Pins advance through reviewed fork changes; upstream updates are not automatic.

## Ownership

| Responsibility | Owner |
| --- | --- |
| Imported editor workspace, header, tool rail, media list and edit-point presentation | Pinned OpenCut components. |
| Project identity, timeline state, graph, processing and editing decisions | OpenScene controller and shared core. |
| Canvas library, blocks, node layout and workflow application | OpenScene UI and shared rules. |
| Local files, credentials, FFmpeg, transcription and agent tools | OpenScene main process. |
| Mobile interface and native export | Mobile host over shared editing rules. |

Adapters in `src/renderer/src/editor/` supply live panels, state and callbacks. Imported `EditorWorkspace`, `EditorHeader`, `EditorToolRail`, `MediaLibrary` and `EditPointNavigation` components do not become another authority for the desktop project. OpenCut's standalone web route has its own browser session; that session and WebM behavior are not OpenScene project state or export capabilities.

## Editing surfaces

Timeline combines the hosted workbench with OpenScene's media dock, Program Monitor, Inspector, timeline, splitters and panel preferences. Project/View/Appearance controls and Windows custom menus route to existing host actions. OpenScene theme tokens style the whole interface.

Canvas switches the central workspace to OpenScene's graph. Its catalog, templates, settings, source snapshots, node coordinates and evaluation belong to the shared core. Applying a graph updates the same timeline used by the hosted editor and FFmpeg export.

Agent tools save current project edits before execution and notify the host after mutations. They operate on shared timeline/graph data without OpenCut browser storage or Electron internals. Filmstrips and waveforms use validated `video-tool-asset:` URLs, never exposed filesystem paths.

## Development

Keep the submodule initialized before root typecheck, tests and build; renderer TypeScript includes imported presentation components. Update the fork through its own review before advancing the OpenScene pin. Preserve main/preload/renderer isolation and mobile parity for editing rules. A newer presentation pin does not by itself migrate the project model or introduce another render engine.

See the [architecture decision](adr/0001-opencut-presentation-boundary.md) and [shared project model](architecture/editor-project.md).
