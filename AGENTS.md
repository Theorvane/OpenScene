# OpenScene Agent Guide

## Architecture

OpenScene has an Electron, React, TypeScript and Vite desktop app over shared editing rules. Mobile support is deferred.

The product edits supplied media through Timeline, a node Canvas and an editing agent over one saved project. Canvas workflows are applied to timeline tracks before review/export. Media generation, production boards and voice synthesis are not active product surfaces.

The desktop process boundary and shared core are organized as follows:

- `src/main/`: Electron main process. Owns desktop capture selection, OS permissions, local file access, project storage, FFmpeg export jobs, local transcription jobs, app menu wiring, and shell open or reveal actions.
- `src/preload/`: typed bridge. Exposes the narrow `window.videoTool` API and never exposes raw `ipcRenderer`.
- `src/renderer/`: React UI. Owns capture controls, project timeline editing, Program Monitor preview, canvas UI, and editor state.
- `src/shared/`: IPC names, validators, timeline models, export types, and provider seam types shared across main, preload, renderer, and tests.

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run build` runs typecheck first, then builds Electron main, preload, and renderer output into `out/`. It does not package an installer.

## Code And Tests

- Tests live in `tests/**/*.test.ts` and run in Node through Vitest.
- Main process tests usually cover stores, validators, job logic, FFmpeg argument boundaries, and IPC services without launching Electron.
- Renderer behavior lives under `src/renderer/src/`, with timeline editor logic split across hooks, model helpers, and components.
- Shared timeline logic and validators should stay in `src/shared/` when both renderer and main process need the contract.
- Canvas catalog, templates, source snapshots, layout and evaluation are shared rules. New editing features must be reachable through the shared batch operations and agent capability discovery as well as their UI.
- Preserve atomic edits: validate the whole batch before one save, then refresh the open editor. Node layout changes must not change media timing or connections.

## Local-First And Security Constraints

- Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, and blocked window navigation.
- File paths, FFmpeg executable paths, FFmpeg argv, transcription input paths, and export paths stay in the main process. The renderer gets typed job status and open or reveal actions.
- OpenScene stores recordings, projects, imported assets, transcripts and exports locally under Electron `userData` unless an explicit local override exists.
- Local storage/export does not imply all agent requests are local. The desktop can call the selected model provider with authorized context; desktop multimodal requests can include sampled frames and transcripts. Preserve existing approval gates and credential boundaries.
- Desktop has no analytics or general cloud-media storage service. Packaged desktop builds have explicit update checks/download/install controls; do not describe that as background automatic installation.
- Agent support follows [capabilities and boundaries](docs/hybrid-ai-editor-direction.md): local models are user-configured and connected providers use the app's authorization flow.

## Compatibility Identifiers

Do not rename these persisted or public identifiers while rebranding docs or UI:

- `window-loom-theme`
- `window-loom-editor-layout`
- `window-loom-editor-shortcuts`
- `application/x-window-loom-timeline`
- `VIDEO_TOOL_*`
- `window.videoTool`
- `local_qwen`

Left behind by the OpenVideo → OpenScene rename, for the same reason the
`window-loom-*` names above survived the one before it — renaming a key does not
migrate what is stored under it, it orphans it:

- `openvideo-*` renderer storage keys (theme-adjacent preferences, model
  selection, workspace tab, reasoning effort, agent chat layout)
- `openvideo.` — the mobile keystore prefix. Renaming this loses every API key
  the user has stored.
- `openvideo-mcp-server` — the MCP server name, which clients match on
- `tech.theorvane.openvideo` — the Electron appId. It identifies an installed
  application: changing it orphans every existing install and silently breaks
  auto-update for anyone already on an earlier version.
- `executableName: openvideo` and the `openvideo-${version}` artifact names
- `OpenVideoMcpServer` / `getOpenVideoMcpDefinition` — source identifiers

## Project Conventions

- Prefer typed shared contracts over ad hoc IPC payloads.
- Treat Program Monitor as best-effort preview. FFmpeg MP4 export is the supported final output for saved local timelines.
- When editing docs, use `OpenScene` for the product name and keep compatibility identifiers exactly as written above.

## Desktop-first scope

Mobile support is deferred by user decision (2026-11-28). The active product is
the Electron desktop app for macOS, Windows and Linux. Do not add or resume
mobile implementation, native modules, mobile CI/store publishing, or mobile
typecheck/device requirements unless the user explicitly reopens that scope.

- Put reusable editing and indexing rules in `src/shared/`; preserve pure typed contracts.
- Keep desktop file access, FFmpeg, credentials and OS operations in `src/main/`.
- A desktop feature does not require a mobile screen or mobile parity work.
- Verify with root `npm run typecheck`, `npm test`, and `npm run build`.
- Exercise affected desktop flows and report unverified platform behavior.
- Mobile code can be recovered from Git history; do not delete or repurpose
  persisted/public compatibility identifiers when restoring it.

## Agent Skills & TypeMCP Integration

- **Agent Skills Location**: `.agents/skills/api-to-typemcp/SKILL.md` (Integrates `api-to-typemcp` skill for converting OpenAPI/Swagger specifications or API docs into TypeMCP MCP projects).
- **TypeMCP Server & Tools**: OpenScene editing capabilities (frame inspection, transcription, timeline editing and export) are declared as standard TypeMCP tools (`@theorvane/type-mcp`) in `src/main/openVideoMcpServer.ts` and exposed over IPC (`window.videoTool.mcpGetTools` / `mcpExecuteTool`).
- `getEditingCapabilities`, `getCanvasWorkflow` and atomic `editProject` expose shared block, layout and timeline operations. Keep the advertised catalog derived from implementation and dispatch only registered, schema-validated tools.

## Required Issue, Branch, And PR Workflow

### GitHub identity preflight

Follow [CONTRIBUTING.md](CONTRIBUTING.md#github-identity-boundary) before every
GitHub operation. Use `node scripts/github-personal.mjs` for repository API
requests: it selects only explicit `sjungwon03` credentials and asserts
`gh api user` in the same invocation before sending any target request.
`sjungwon03-imbc` is forbidden; never inspect company tokens, switch global
authentication, or fall back to default credentials. Independent reviews use
only `sjungwon03-ai`, with their own same-command identity assertion. Verify
personal Git author and committer separately, and never rewrite history or
delete historical records to repair account misuse.

Every change after the initial repository bootstrap follows this sequence. Never commit directly to protected `dev` or `main`.

1. Inspect open GitHub Issues and pull requests, then create or update one focused GitHub Issue before branching.
2. Put the issue number in the branch name: `<type>/<issue-number>-<short-description>`, such as `feat/12-tool-compiler` or `chore/1-strict-workspace-baseline`.
3. Branch from the current `origin/dev` unless a documented stacked pull request requires another base.
4. Implement one coherent issue only. Use conventional commits in the format `type(scope): subject`.
5. Push the branch and open a pull request against `dev` with `Closes #<issue-number>` in the body.
6. Run and report fresh verification evidence. Obtain specification and code-quality review before merging.
7. Squash merge only after CI and review pass. Verify the issue closes and `dev` contains the merged commit.
8. Promote vetted `dev` to release-only `main` through a separate reviewed release pull request. Verify `main` contains the release commit before publication.
9. Mobile store releases are suspended. Do not restore App Store/Google Play jobs or store listing actions without an explicit scope decision.
10. The version in `package.json` is the release decision. Bump it on `dev` before promoting: the push to `main` tags `v<version>`, creates a `release/v<version>` branch, packages macOS, Windows, and Linux on their own runners, and publishes the release with every artifact attached. Promoting without a bump republishes nothing, by design.

## Local FFmpeg editing skill

For authorized repository-side video/audio work, read `.agents/skills/ffmpeg-skill/SKILL.md` and `docs/ffmpeg-skill-integration.md`. The pinned upstream tools are for coding agents, not automatically registered in-app tools. Preserve originals, plan from measured metadata and verify outputs; do not install dependencies, download models or start MCP servers implicitly. The in-app workflow is adapted in `src/shared/ffmpegEditingWorkflow.ts` and respects each surface's existing tool/approval boundaries.
