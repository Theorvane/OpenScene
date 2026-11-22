# Keep the OpenCut workbench separate from OpenScene project authority

OpenScene uses OpenCut components for the editor's layout and controls, with host-supplied identity, theme, and action callbacks. OpenScene owns the persisted project, shared desktop/mobile editing rules, local media access, native export, and Agent tools. We chose this boundary over embedding OpenCut's standalone browser editor because both editors would otherwise hold separate timeline and media state for one visible project, letting preview, Agent edits, and export disagree. The standalone OpenCut web route remains a browser editor with its own local session; its project data is not an OpenScene project.

The node Canvas follows the same decision. Its graph, original-source snapshots, settings and layout are optional OpenScene timeline metadata. Applying a graph materializes its lanes into that authoritative timeline. Agent batches use the shared evaluator rather than a second editing engine. New blocks and layout controls therefore extend the OpenScene core and both platform adapters without changing the OpenCut project boundary.

See [current architecture](../architecture/editor-project.md) and [integration guide](../opencut-integration.md).
