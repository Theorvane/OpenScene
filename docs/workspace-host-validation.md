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

## Local verification

- Root typecheck passed.
- Full Vitest run: 250 files, 1,664 tests passed.
- Root production build passed; mobile typecheck passed.
- After responsive CSS and candidate navigation refinements: focused workspace,
  mounted host, impact and CUA overlay checks: 26 tests passed; build passed.
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
Original failed artifacts remain; no successful rerun is claimed until recorded.

## Remaining validation and scope

Linux VM203 mounted-renderer screenshots, resize/zoom, keyboard/IME, menu/modal
and Stop checks are pending coordinated GUI ownership. Linux does not establish
macOS focus/permissions, actual human selection or live-model quality. No live
model/API calls are authorized for QA; the incident above is an explicit failure,
not a completed quality gate. Mobile has its existing editing screen; this
Electron host and self-window CUA arrangement are desktop-specific. No mobile
development-client screen exercise is claimed.

The custom natural conversation/candidate presentation and synchronized candidate
navigation in the outer shell are later stages; this change deliberately retains
the complete real review/export controls instead of projecting example data.
