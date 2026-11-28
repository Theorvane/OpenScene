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

## Integration review and renderer follow-up

Independent review reproduced two P2 defects against the initial integration
head `e48c0a15`: an A-project approval could prepare project B after navigation,
and native playback could advance the hidden edited clock during source inspection.
The regression tests failed against that head and pass with the fixes. Pending
approvals now retain their project/conversation owner, lock sidebar navigation and
revalidate identity both before and after asynchronous save preparation. Tests
cover switching before approval and during preparation. Hidden source/Settings
contexts disable edited-clock menu/shortcut playback; preview also settles an
attempted hidden playback restart. Save and history remain available in source
inspection.

Fresh Orca embedded-browser verification used the built renderer with an isolated
in-memory bridge and a generated four-second 640×360 video served only on loopback.
CSP and throwing fetch/XHR/WebSocket/EventSource boundaries blocked external
network; no model/discovery/approval request was made. The onboarding dialog was
modal at exactly (0,0,980,680), and Next/Skip worked. Actual video decoded at
readyState 4 and advanced during playback. Natural showed one chat; Precision and
Nodes showed zero while retaining the same prompt/monitor elements. One project
creation control, disconnected-provider guidance and disabled Send were observed.
No page horizontal overflow occurred at 980×680 or 1440×1000.

This verification found a legacy sidebar width/grid layout clipping the natural
composer. The bottom chat now fills the workspace width, accounts for all five
rows and reserves composer space; at 980×680 Send ends at y=666, within the viewport.
The compact preview leaves the timeline reachable alongside chat. Screenshots
were visually inspected and contain synthetic media only.

These are browser renderer observations, not native Electron/IPC verification.
Native preflight returned `screen_locked`; no native launch, focus restore or
blind retry followed. The coordinator requires native verification after unlock
before merge. Temporary loopback server/tab ownership and cleanup are recorded by
the integration worker; no user project, media, model setting or account was used.

The user subsequently redirected native QA to the currently connected Linux host;
Mac unlock is no longer a prerequisite. Supported inventory and Infra confirmed
`llm-server`, environment `d70cab04-190a-485d-a5b0-60751a703a5c`, display `:2`.
The coordinator authorized a new disposable staging directory beneath
`/home/ubuntu/gui-validation/item188-pr599-81f623b8` and reserved this worker as sole
GUI operator. No shared desktop, GPU, pairing, permission or model service changed.

An exact-commit sanitized source archive, including pinned submodule sources, was
transferred using strict host verification. Existing Linux dependencies have the
same package-lock SHA-256 `81e13871580d4d0d1bcc9d3aa8f81b21f8f14e352563a4eb6fb61aab30f74521`;
the existing Electron runtime is 43.1.1 and the existing portable Node is 24.22.1.
The source built on Linux without downloads or installs. The isolated profile
contains only generated synthetic footage and projects; fail-closed network
tripwires are installed and negatively tested before importing the actual main
process. Native screenshots and supported Orca app observation identified a real
OpenScene window with decoded synthetic video. Native edit/Undo/Redo/save and
mode/chat lifetime checks ran through the actual main/preload/renderer boundary.

Native visual inspection additionally found long project names expanding the
sidebar's intrinsic minimum width. The sidebar now permits shrinking to its
declared width so project-name ellipsis preserves the workspace. Final exact-head
native results, artifact paths, limitations and owned-process cleanup are recorded
in the PR receipt. Browser and native evidence remain distinct.
