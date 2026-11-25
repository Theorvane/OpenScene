# Desktop workspace host — issue 575

This is a first functional Phase 1B vertical change over the merged Phase 0,
Phase 1A and CUA foundations at dev d448f6e2eab38cc656e106ca8442fa26dad99686.
It connects the mounted desktop editor to equal 자연어 (default), 정밀 and 노드
tabs. One editor controller owns the project, Undo history, dirty state, playhead
and playback. The live review, timeline and monitor remain mounted across modes.

Natural uses the existing Shorts review workspace, including real job list/get,
cancel, materialize, isolated result editing and batch export APIs. The existing
AgentChatPanel remains the single conversation/approval controller beside it.
Empty projects use WorkspaceIntakeView with the actual import dialog; drafts are
kept in the chat input and are not sent automatically. The picker does not promise
unsupported file drop handling. Assets opens the actual media dock in precision;
Settings, including Jev, remains the existing settings page. Candidate navigation
is owned by the real job review, so the shell does not show a fabricated zero count.

Both node apply entry points preview the existing shared evaluator's actual
result before one existing controller edit. The summary compares current clips
and transitions; it does not claim to identify manual provenance or offer
selective caption preservation. A changed timeline invalidates the preview.

Natural/intake expose no CUA safe surface. Precision uses the actual mounted
timeline geometry and nodes retain the existing canvas geometry. Mode/layout
changes use the existing observer/revision invalidation; prepare ACK, terminal
receipts, Save 3ACK, cancellation/rollback, protected chat and fixed external Stop
remain unchanged. Approval technical metadata is expandable. No main, preload,
shared, driver or model authority contracts change.

## Verification

- Root typecheck passed.
- Final product pin CI verify: 253 files, 1,675 tests passed.
- Root production build passed; mobile typecheck passed.
- Final compact host/geometry checks: 27 tests passed; build passed.
- One earlier full run hit the existing same-size source mutation timing test;
  that test then passed in a focused run and the fresh full suite above.

Mounted host tests exercise default view, persistent child identity, playhead and
playback presentation, shared Save/Undo/Stop routing, hidden precision geometry
and keyboard locking away from precision. Shared apply-result tests compare a
real trim operation with its impact summary. Existing CUA and Shorts tests remain.

## Review corrections and QA incident

Independent review found an A→B late Shorts response could populate B. An initial
project-key remount fixed that response race but introduced a P1: it discarded
unsaved inline result drafts. That intermediate fix is superseded by per-source
controllers and caches. Only the active controller renders UI/IDs and polls;
late responses stay in their own source cache, and delayed navigation/export
continuations require the same active epoch. Deleted source controllers are
disposed and cannot be resurrected by a late response. Clean idle retention is
capped at four besides the active controller. Dirty/in-flight controllers are
never implicitly evicted; their population is bounded by the actual enumerated
local project inventory. Explicit save/reload and deletion provide cleanup.

Actual mounted-controller regressions cover edited A→edited B→A, failed A save
while B is active, eviction pressure, deletion/reopening, two deferred A/B starts
and paused inactive polling. The main ordinary Save race found independently is
inherited, tracked separately under item99, and is not changed by this PR.

The first 6055dee layout run exposed a missing IME guard in the existing real
AgentChatPanel. A synthetic composing Enter submitted one fixture agent request
to the default local Ollama configuration (`http://localhost:11434`) and returned
`fetch failed`. This violated the intended no-live-attempt QA constraint. The
underlying HTTP/retry count was not instrumented, so one agent request does not
establish one HTTP attempt. No successful model/media result, human selection,
credential access or Jev invocation is claimed. Jev remained PID5854/NRestarts0.
The old harness's static no-live flag and early completion-time zero-send check
are not accepted as evidence. That run also stopped on actual 980px body overflow
at 1280/150%; the workspace now removes that inherited desktop minimum.

The real composer now ignores isComposing, key229 and Process while preserving
ordinary Enter and Shift+Enter. The replacement QA records agent IPC at request
start, installs throwing model/fetch/HTTP/socket boundaries before app import,
verifies them with non-network negative probes, and cancels Chromium HTTP before
dispatch. It asserts zero product invocation/network attempts and zero sends.
Original failed artifacts remain and are excluded from the passing evidence below.

## Completed VM203 evidence

### Final host lifetime audit

The evidence at 98c0f75 below predates a final audit finding: the host still
unmounted the entire registry when an empty project entered intake or the editor
became projectless. Two real mounted host/controller regressions reproduced
edited/dirty→original/clean without a save. The host now keeps that registry in
a stable stage, disables it synchronously during intake/projectless or inactive
workspace pages, and does not use an effect-delayed initial intake decision.
Inactive controllers render no UI, schedule no polls and cannot launch a queued
poll after deactivation. Their in-flight responses may settle only into their
own cache. Project-tab/page closure hides the persistent editor rather than
discarding its drafts; explicit source deletion prunes its controller. Actual
host unmount cleans up old requests so they cannot resurrect a job in a new host.

Three real host regressions cover empty-project intake, projectless and hidden
workspace round trips with dirty result drafts and no implicit saves/review
requests. The deferred external-unmount regression and prior source A/B/deletion
tests remain. Fresh local verification after this fix passed root typecheck,
254 files / 1,679 tests, build and mobile typecheck. The guarded impact harness
now uses a second real empty fixture, explicit deletion of only that empty
fixture, projectless return and six affected size/zoom/view cases. Final exact
pin/CI and affected runtime receipts are recorded on
[PR576](https://github.com/Theorvane/OpenScene/pull/576); do not substitute the
earlier matrix pin below for validation of the final lifetime fix.

### Earlier complete layout and CUA matrix

Product and harness pin: `98c0f750e58df414fb2cb1bd3ff66f0903c7040a`.
The before screenshot was captured from reviewed foundation `1067e142` (the tree
used by merged dev d448); all after evidence below comes from the product pin.

- Mounted renderer: 33 captures, including all three tabs at 1280×800,
  1440×900 and 1920×1080, each at 100%, 125% and 150%. Document overflow,
  tab visibility, Stop hit target and preview/node control overlap checks passed.
  Contact sheets and full-size compact, precision, node, menu and modal images
  were visually inspected. Narrow views use explicit vertical scrolling.
- Real source edit: live start 0→3325ms/dirty, retained across all tabs; Undo→0,
  Redo→3325; explicit Save persisted 3325ms and cleared main timeline dirty state.
  The actual still preview loaded, playback survived tab changes, and the unsent
  Korean draft survived. Composing Enter submitted zero requests.
- Natural/intake expose no safe surface. The actual Shorts list API returned
  an empty list. No candidate creation, successful media or model quality is
  inferred from this fixture. Existing real-service integration tests cover the
  review/materialize/result-edit/export adapters with synthetic selection.
- The compact node body was user-scrollable. Its actual scroll advanced the
  renderer layout revision 25→26 with the same canvas geometry, invalidating the
  old scope. Node impact cancellation, menu portal, project modal and Settings/Jev
  were exercised. Original fixture image bytes remained identical.
- The sequential existing synthetic CUA harness passed `save-deny`, `move-save`
  and `cancel` on this host. Denied Save left disk at 0ms; approved Save returned
  persisted/diskMatches/uiApplied 3ACK at 139ms; synthetic native Undo/Redo/menu
  Undo and explicit user-role Save retained their assertions. Stop during held
  drag rolled back to 0ms and exited with held inputs `[]` and complete release.
  Native user-role Undo is not a production CUA-key or human-selection claim.
- Both final runs verified throwing bindTools/invoke, fetch, HTTP, HTTPS and
  socket negative probes before product import. Product HTTP/socket attempts
  were zero, and Chromium HTTP was cancelled before transport. The layout run
  also recorded zero agent sends/model invocation attempts. The CUA harness used
  only its explicitly synthetic planner; its saved fallback was the throwing
  guard, not a live model.
- Actual WebGL renderer: ANGLE / NVIDIA GeForce RTX3060 / OpenGL4.5. GPU
  compositing/rasterization/WebGL were enabled; video encoding remained software.
  Jev stayed PID5854, NRestarts0, start time 2026-11-25 01:49:12UTC; NVIDIA driver
  stayed 580.178.04. Final inventory had no Electron process and only Xfwm4.

Artifacts on the QA operator's machine:

- `/tmp/vm203-qa-screenshots/phase1b-baseline/`
- `/tmp/vm203-qa-screenshots/phase1b-98c0f75/` — captures, contact sheet,
  evidence.json, post-receipt.txt.
- `/tmp/vm203-qa-screenshots/phase1b-98c0f75-cua/` — terminal receipts, images,
  network-guard.json and the exact test-only wrapper.

Workspace harness SHA256: `a5b0311f55dc72bda95d09fdb3472900b063bcbd96e392bbb34159c66a6fe150`.
Network guard SHA256: `5c092cd1c1b605d6f4c1a81d93e996c1455f984513d4ef534dbc717df16c8438`.
CUA wrapper SHA256: `5bb64d310a3d4852933520a954710734b38ca06af4dd1904e325d9f9ad6eb6a7`.

The final runs retained the existing CSP meta frame-ancestors warning and MESA
GBM permission warning. The harness also reports its deprecated console-message
callback signature. No renderer exception was recorded in the final runs; these
warnings were not suppressed or treated as fixes.

## Remaining validation and scope

Linux VM203 checks above do not establish
macOS focus/permissions, actual human selection or live-model quality. No live
model/API calls are authorized for QA; the incident above is an explicit failure,
not a completed quality gate. Mobile has its existing editing screen; this
Electron host and self-window CUA arrangement are desktop-specific. No mobile
development-client screen exercise is claimed.

The custom natural conversation/candidate presentation and synchronized candidate
navigation in the outer shell are later stages; this change deliberately retains
the complete real review/export controls instead of projecting example data.
