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

## GitHub identity boundary

For human and coding-agent activity on Theorvane/OpenScene, use only explicit
personal `sjungwon03` credentials. `sjungwon03-imbc` is forbidden here. Never
inspect or use company tokens, switch global GitHub authentication, or fall back
to the default `gh` account. Independent reviews must be performed by a separate
reviewer using `sjungwon03-ai`; an author must never approve their own work.

Use the fail-closed API wrapper for repository requests:

```sh
node scripts/github-personal.mjs repos/Theorvane/OpenScene/issues --jq '.[] | {number,title}'
node scripts/github-personal.mjs repos/Theorvane/OpenScene/issues --method POST -f title='Focused issue' -F body=@/absolute/path/body.md
```

The wrapper reads only the explicitly named personal credential from `gh`, clears
ambient GitHub credentials and debug settings, calls `gh api user`, and requires
the exact `sjungwon03` login before dispatching the target with the same token
and fixed github.com host. Missing credentials, failed identity checks and
mismatches stop before any target request. It rejects host/header/cache overrides
and endpoints outside this repository. It does not authorize the requested
action: follow the task's scope and approval requirements. Do not log tokens.

For operations outside this API wrapper (including Git transport), explicitly
select the personal credential and assert `gh api user` in the same command
before the operation, with the identical credential and host. Never rely on an
earlier identity check or change global credential helpers. Independent reviewers
must apply the equivalent exact `sjungwon03-ai` assertion themselves.

Before committing, check `git var GIT_AUTHOR_IDENT` and
`git var GIT_COMMITTER_IDENT` against the intended personal identity. Git commit
metadata and GitHub authentication are separate. Correct local configuration
when necessary; do not rewrite historical commits to repair attribution.

The wrapper is local repository tooling, not a machine-wide interceptor. Another
machine or agent is protected only after it receives and verifies these files.
Record delivery receipts and verification; a missing reachable Orca connection
does not establish remote correction. Preserve historical issues and comments;
coordinate any attribution correction separately.

Run `npm run typecheck`, `npm test`, and `npm run build`. The guard's negative
tests use injected subprocesses and make no live target requests.
