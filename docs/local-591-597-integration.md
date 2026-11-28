# Approved desktop patch integration (#598)

## Scope and provenance

The user authorized applying the MacBook handoff to OpenSceneTF, with desktop
priority, removal of mobile implementation/automation and removal of the CUA
runtime. This supersedes previous mobile parity and CUA preservation instructions
for this scope. Release, version changes, model downloads, paid inference and
production provider calls are excluded.

Fetched `origin/dev` was `3a9799469b5333f50311eb403c83bd61f6b7ff32`, exactly the
handoff source base. Open issues and PRs were inspected before creating #598 and
branch `feat/598-approved-desktop-integration`. No equivalent integrated change
was found. Separate REA PR #590 and its dependency branches remain outside scope.
Frontend confirmed no active worker, reservation or open PR; Backend confirmed
the separate #590 reservation; LLM confirmed no current reservation. The
coordinator cleared sole application of this handoff after those responses.

Both supplied tar archives were inspected before extraction: no absolute paths,
parent traversal, symlinks, devices or executable payloads. AppleDouble metadata
was identified by its magic and excluded, including a metadata entry carrying an
execute bit. Only patches, Markdown and the synthetic onboarding PNG were staged.
No private media, keys, environment files or FFmpeg executable were supplied.

Applied in order, with no conflicts and no skipped equivalent patches:

| Original commit | Change |
| --- | --- |
| `4516a47` | Full source preview and immediate natural workspace |
| `ab2bd70` | Shared transport and source component lanes |
| `18cc666` | Desktop focus; remove mobile implementation and automation |
| `5fd4190` | Accessible icon transport controls |
| `f11dcc5` | Conversational default, requested Shorts, common history/results/theme |
| `facaf42` | Explicit providers, discovered Ollama models, manual model selection |
| `f7c2128` | Single project sidebar, full-window native onboarding, remove CUA |

The integration additionally removes the obsolete mobile parity requirement from
the PR template. Generic Jev credential/config persistence remains; the CUA-only
observation hooks and UI are removed as authorized. Generic structured editing
approval/cancellation, main-process path/credential boundaries, shared history,
manual save races, source epochs and durable Shorts output checks remain covered
by the root regression suite.

## Evidence boundaries

#592 is design/planning and synthetic mechanism evidence only. This integration
does not implement automatic indexing, RAG or wiki, nor establish embedding/ASR
quality, real provider inference or a complete model-driven editing flow.

The author's 238-file/1321-test report and synthetic MP4 evidence describe the
source handoff, not fresh integration checks. Fresh integration commands and
results are recorded in the PR. The optional real-export test creates synthetic
video/audio and deterministic transcript evidence, renders two portrait MP4s,
reopens completed results through a fresh export service and compares the original
source hash; it makes no ASR/highlight/model-quality claim.

The initial Orca setup failed because pnpm blocked `electron-winstaller` build
scripts. Its generated lock/workspace changes were saved outside the repository
and excluded. `npm ci --ignore-scripts` and pinned submodule initialization restored
the repository's npm dependency layout without a dependency change. Local Node
26's experimental global Web Storage interferes with jsdom; disabling that feature
is a test-run environment adjustment, not an application behavior change. CI uses
Node 22. The local Homebrew Node 22 copy-based transcription fixture cannot launch
its relocated executable; this environment limitation is distinct from the
transcription service or actual ASR validation.

Independent specification/code-quality approval and exact-head CI are required
before a normal squash merge to `dev`. No bypass, force merge or release is allowed.
