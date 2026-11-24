# OpenScene documentation

OpenScene is a natural-language video editor. Describe what you want, review the result, and refine it with timeline and node-based editing.

The editing flow is natural-language requests → precise Timeline refinement → Canvas workflows and quick-start recipes over supplied media. A core desktop workflow turns local video files into multiple reviewable, editable shorts and batch exports; see [current scope](local-shorts-backend.md) and [verification limits](shorts-media-validation.md). Existing node graphs and quick starts are implemented; broader reusable recipes, CUA and Jev integration remain roadmap work. These guides distinguish current capabilities from planned work.

## Using the editor

- [Product and setup](../README.md): editing flow, installation and commands.
- [Canvas workflows](canvas-workflows.md): quick starts, 12 blocks, original inputs and arrangement.
- [Menus and layout](editor-menu-layout.md): desktop controls and mobile equivalents.
- [Precise clip manipulation](timeline-snapping.md): snapping, trims and manual checks.
- [Caption delivery](planning/2026-09-07-subtitle-delivery.md): burn-in and sidecar rules.
- [Mobile](../mobile/README.md): touch editing, assistant and native export.

## Developing

- [Editor design](../DESIGN.md): interaction and processing semantics.
- [Shared project architecture](architecture/editor-project.md): timeline, graph and platform ownership.
- [Agent capabilities and boundaries](hybrid-ai-editor-direction.md): discovery, atomic edits and multimodal evidence.
- [OpenCut integration](opencut-integration.md) and [architecture decision](adr/0001-opencut-presentation-boundary.md): presentation boundary and submodule maintenance.
- [FFmpeg integration](ffmpeg-skill-integration.md): coding-agent skill versus in-app tools.
- [Legacy metadata](architecture/ai-project-domain.md): compatibility with earlier projects.
- [Contributing](../CONTRIBUTING.md) and [agent guide](../AGENTS.md): development requirements.

## Verification and delivery

- [Canvas-to-export verification](canvas-export-verification.md): recorded execution and acceptance checks.
- [Linux media-analysis environment](media-analysis-environment.md): media tools, full-suite checks and Windows integration.
- [Menu and bridge analysis](rea-editor-evidence.md): optional analysis of OpenScene's own build.
- [Mobile native setup](../mobile/README-native.md) and [release procedure](../mobile/RELEASING.md).

Test records describe their named revision and environment. Device tests, model conversations and static analysis have separate verification scopes.
