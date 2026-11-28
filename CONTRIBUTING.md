# Contributing to OpenScene

OpenScene is a local video editor with Timeline, a node Canvas and an editing agent. Active development targets the Electron desktop app; mobile support is deferred. Keep media storage and rendering on the user's device; model requests use the explicitly chosen provider and existing approval gates.

## Before You Start

- Search existing issues and pull requests before opening a new one.
- Use a **bug report** for reproducible defects and a **feature request** to discuss new ideas before investing in a large change.
- Do not include credentials, private media, private file paths, security exploit details, or other sensitive material in public issues or pull requests. See [SECURITY.md](SECURITY.md).

## Development Workflow

1. Create or find a GitHub issue that describes the change.
2. Update your local `dev` branch, then create a focused, issue-numbered branch from it. Use `<type>/<issue-number>-<short-description>`:
   ```bash
   git switch dev
   git pull --ff-only origin dev
   git switch -c feat/123-short-description
   ```
3. Make small, focused commits using [Conventional Commits](https://www.conventionalcommits.org/), for example `feat: add local export preset`, `fix: reject invalid media path`, or `docs: clarify FFmpeg setup`.
4. Add or update tests for behavior changes. Run the relevant focused test first, then run the full checks:
   ```bash
   npm ci
   npm run typecheck
   npm test
   npm run build
   ```
   FFmpeg-backed tests require a local `ffmpeg` executable on `PATH` or `VIDEO_TOOL_FFMPEG_PATH`; do not skip or weaken media tests.
   Initialize `external/opencut` before these checks. Editing behavior belongs in `src/shared/` and must be exposed through desktop UI and agent capability discovery. Exercise affected desktop flows and report any unverified platform behavior.
5. Push the branch and open a pull request **to `dev`**. Complete the pull request template, link the issue, and describe validation performed.

Releases are prepared separately through reviewed pull requests from **`dev` to `main`**. Do not target feature work directly at `main`.

## Code and Security Expectations

Read [AGENTS.md](AGENTS.md) before changing application code. Preserve the Electron main/preload/renderer boundary, typed IPC contracts, and local-first behavior. Never expose raw Electron or Node APIs to the renderer, add telemetry or network calls incidentally, or commit generated media, secrets, or user data.

Canvas evaluation, templates and node arrangement share one implementation. Agent batches must validate before one save; malformed inputs must not partially mutate a project. Keep original media intact and preserve old project codecs and identifiers. See the [architecture](docs/architecture/editor-project.md) and [documentation index](docs/README.md).

For media changes, verify a real export's frames, audio and measured output. The optional [Linux environment](docs/media-analysis-environment.md) runs a committed snapshot with executable FFmpeg/FFprobe and separate dependencies. Documentation-only changes need link/content checks and relevant existing documentation tests; report historical media results as historical.

## Review Expectations

A pull request should have one clear purpose, include tests or a rationale when tests are not applicable, keep documentation accurate, and leave the full verification suite passing. Reviewers may request a narrower scope or a follow-up issue for unrelated work.

## Conduct

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
