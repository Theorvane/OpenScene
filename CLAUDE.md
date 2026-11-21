# OpenScene development

Follow AGENTS.md for architecture, security, compatibility identifiers and verification.

The product edits imported media through Timeline, a node Canvas and an editing agent over one saved project. Apply canvas results to the timeline before preview/export. Shared modules own blocks, templates, original-input snapshots, node layout and atomic editing batches; agents discover the same capabilities.

Main-process services own files, credentials, FFmpeg, transcription and desktop tool execution. Desktop and mobile share editing decisions in `src/shared/`. Preserve approval boundaries and state each platform's limits. Generation workspaces and voice synthesis are not active surfaces.

Run root typecheck, tests and build, plus mobile typecheck. Existing project codecs must preserve imported assets and timelines from earlier versions.

Start documentation updates with [the documentation index](docs/README.md). Record verification by revision and distinguish actual app tests, scripted tool calls, model conversations and mobile-device checks.
