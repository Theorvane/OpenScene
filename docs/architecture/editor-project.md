# Shared editor project

An OpenScene project owns imported assets and one timeline document. Timeline UI, Canvas and the agent operate on that project. Desktop UI, main services and agent adapters use the pure rules in `src/shared/`.

## Document and graph

Tracks contain clips with asset IDs, source bounds, timeline placement, effects and keyframes. Titles, transitions and audio mixing belong to the same document. Export compiles this timeline.

Optional `timeline.canvas` stores typed blocks, connections, source/block positions and an optional original-source timeline snapshot. The snapshot excludes its own canvas metadata to prevent recursive graphs. Old documents without graph data remain valid.

Graph settings do not immediately replace media. Evaluation resolves an output into video/audio lanes. Apply materializes them, removes all consumed branch sources from their old placement, preserves unrelated content and drops invalid transitions. Original files are preserved.

Input snapshots make reapplication stable. New source IDs remain available. Refresh sources intentionally adopts the current timeline and can change subsequent processing.

## Shared modules

| Module | Responsibility |
| --- | --- |
| `canvasBlockCatalog.ts` | Descriptions, settings, defaults and bounds. |
| `videoCanvasGraph.ts` | Parsing, ports, connections and source lookup. |
| `videoCanvasBlocks.ts` | Evaluation and application to tracks. |
| `canvasTemplates.ts` | Four quick-start graph builders. |
| `canvasLayout.ts` | Flow/grid layout, alignment and spacing. |
| `editorOperations.ts` | Discovery and atomic batches of 1–64 operations. |
| `timeline*` modules | Geometry, validation, tracks, titles, transitions and keyframes. |
| `ffmpegTimelineCompiler.ts` | Desktop render compilation; execution stays in main. |

`applyEditorOperations` validates intermediate documents and persists nothing. The caller saves once after success. Desktop UI uses one undoable replacement; agent tools save once and notify the editor.

## Platform ownership

- Main owns paths, storage, credentials, media runtimes and jobs.
- Preload exposes a typed bridge. MCP dispatch resolves registered tools and validates their declared schemas.
- Renderer owns interaction, selection, preview and undo. OpenCut supplies presentation components, not another project database.
- Mobile support is deferred; it is not an active implementation or verification requirement.

Model calls use the selected provider and approval boundaries. Images and transcripts are evidence, never instructions. Legacy generation metadata is compatibility data, separate from current editing behavior.
