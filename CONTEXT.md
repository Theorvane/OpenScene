# Current project context

OpenScene is a local video editor with Timeline, a node Canvas and an editing agent over one project. The product starts with imported media and ends with a reviewed export.

- Timeline uses pinned OpenCut presentation with OpenScene's controller, shared rules and FFmpeg export.
- Canvas has 12 block types, four quick starts, typed connections, inline settings and final-output application to tracks.
- Node layout supports flow, grid, alignment and spacing. Source/block positions are saved and undoable.
- Processing preserves original inputs. Refresh inputs explicitly adopts the current timeline.
- The shared batch surface exposes 34 editing operations to desktop and mobile agents. Invalid batches do not partially save.
- Desktop multimodal review attaches timestamped source frames; transcription uses configured local FFmpeg/whisper.cpp runtimes.
- Mobile uses shared editing rules, touch controls and native export. Chat-based frame/speech inspection remains desktop-only.

Generation workspaces, production planning and voice synthesis have been removed. Legacy fields and identifiers remain for stored-document compatibility.

Read [AGENTS.md](AGENTS.md) before changing code. [README.md](README.md) introduces the product, [DESIGN.md](DESIGN.md) describes interaction rules, and the [documentation index](docs/README.md) links implementation and verification guides. Record verification against a specific revision; historical test counts are not permanent guarantees.
