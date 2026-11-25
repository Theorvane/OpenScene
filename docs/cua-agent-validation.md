# Self-window agent approval validation

Issue #559 / Draft PR #561. Initial base: `fdce65209afe784e92774e8c7d1fdd0daaf88e6c`. Backend #558 contracts and runtime were normally merged; Backend retains ownership of driver, bridge, IPC channels and main wiring. Frontend overlay/pointer integration is a coordinated dependency.

## Reproduction

```sh
npm ci
git submodule update --init
npm run typecheck
npm test
npm run build
cd mobile && npm ci && npm run typecheck
```

After building, run the test-only entry from the repository root:

```sh
CUA_AGENT_EVIDENCE_DIR=/tmp/openscene-cua-agent-app-check node_modules/.bin/electron scripts/cua-agent-app.integration.mjs
```

The entry creates a unique profile and local image fixture, starts the actual built main/renderer, and substitutes only `ChatOllama.invoke` with deterministic model tool calls. Approval, own-sender IPC, driver validation, focus, frame/snapshot checks and input cleanup use production code. The harness records unchanged forwarded `sendInputEvent` calls, distinguishing setup/UI input from product driver input, alongside screenshots, actual model call stages, state transitions and DOM event observations. Fixture preparation precedes startup; it never changes editor state to simulate an edit. MCP creates the clip and verifies the saved state. The final move-save scenario requests a separately approved live-editor Save, then the model invokes saved-state MCP. Native target-window Undo and menu Redo/Undo are separate user-role checks.

`CUA_AGENT_SCENARIOS=deny,stale,duplicate,save-deny,move-save,cancel` selects prepared scenarios. A successful run is not established until all selected assertions pass. Denial and intentionally mismatched frame IDs must dispatch zero product inputs. Move-save requires one product pointer-down, a separately approved live Save receipt with diskMatches/uiApplied, and the actual model tool loop reading changed saved MCP timing. Native target-window Undo and menu Redo/Undo are recorded separately; explicit user-role Save then verifies the restored disk timeline. Save denial preserves dirty live edits and performs no publication. Mid-drag cancellation awaits the real driver promise, including rollback acknowledgement and physical release, requires successful cleanup and zero outstanding recorded inputs, and verifies unchanged saved timing. These prepared scenarios are not evidence that they have passed on the final integrated app.

The setup selects only its own test app once with `app.focus`, `window.focus` and `webContents.focus`. It never changes or retries production focus policy. With explicit coordinator/user arrangements, `CUA_AGENT_WAIT_FOR_FOCUS_MS=60000` allows up to one minute for the user to select the identified test OpenScene window. Missing focus otherwise produces an actual observation-tool refusal and nonzero process exit. No debug port, remote control service, paid model call or production startup hook is added.

The legacy move scenario and the post-Undo persistence check use a separate, human-assisted Save action: the harness clicks the existing protected header button in its user role, observes the unchanged `project-timeline:save` handler's successful main-process response, then requires the dirty asterisk to clear before querying MCP. This does not prove an agent can save autonomously. The current CUA driver cannot target that protected header or invent a saving shortcut. Undo first verifies the restored live clip geometry; a subsequent explicit Save and main acknowledgement make that restoration visible to the saved-state MCP query. Save failures or a remaining dirty marker fail validation rather than treating the older saved snapshot as the current UI.

CUA observation and actions must each occupy a single model tool step. A mixed step is rejected in its entirety before any approval proposal or tool invocation, including MCP calls placed before the CUA call. Recovery requires fresh call IDs and a separately approved action. The main authority's non-consuming `check(request, permit)` allows driver preparation to verify the original permit, and `consume` repeats the same checks immediately before input. Neither check extends the original permit clock or changes frame/scope evidence.

## Intermediate actual-app result

On production source HEAD `310eb0a9fff665989d4ced8e79f33d51ec9175d4` (before final Frontend integration), the isolated actual OpenScene app created a two-second image clip through `mcpExecuteTool(addClipToTimeline)` and verified it through `getProjectTimeline`. The real renderer opened and displayed the clip. Window ID 1 / title `OpenScene` reported both `isFocused()` values false after the one-time setup activation. The synthetic model called the real `observeEditorWindow` tool; it returned `CUA_NOT_FOCUSED`. Recorded product input calls and outstanding inputs were both zero. The harness exited 1, preserving the focus guard.

Local evidence: `/tmp/openscene-cua-agent-app-initial4/evidence.json`, `00-actual-app-before-observe.png`, `actual-product-focus-refusal.png`, and `failure.png` in that directory. The evidence JSON includes source HEAD and the isolated profile. This intermediate execution used the then-uncommitted test script; subsequent harness runs also record its SHA-256 and working-tree status. It establishes a real product focus refusal, not successful CUA move, cancellation during held input, UI Undo, final Frontend integration or live-model quality.

## Verification boundary

At pushed agent HEAD `58a25f499cdc85233b66a170c133c7043ad55323`, root typecheck, 219 test files / 1,387 tests, build and mobile typecheck passed locally. Its `verify`, `ios-module`, `android-module` and `ios-export` CI checks passed; automatic review was skipped for Draft. Later dependency merges and the E2E script require fresh exact-HEAD verification and independent review. The PR must stay Draft until coordinator authorization; no readiness or merge is implied by these intermediate checks.

## Explicit interaction mode

The default is `Project tools`. Window control requires the user to select `Window CUA (desktop)`, which waits for the previous conversation's cancellation/storage settlement before starting a new conversation. Busy/pending approval blocks a mode change. Restored history and new ordinary sessions never opt into window control automatically. The main session fixes mode and project identity; model clients bind tools per invocation, and project mode also rejects fabricated CUA tool calls at dispatch.

In explicit self-window mode, the real send/approval preparation functions do not invoke legacy project saving. Live project identity still follows the existing context bridge. Dirty or unspecified live state blocks saved-project and unknown tools by default; only the pure editing capability catalog and the observed CUA/explicit Save capabilities are allowed. Successful input conservatively marks the UI unsaved. A confirmed Save receipt must match disk and the current UI acknowledgement before saved-project tools are released. Driver frame/content checks remain independent of any client clean flag.

Intermediate actual-app evidence at `/tmp/openscene-cua-agent-dirty-mode-e604-char/evidence.json` records an actual user-role fixture drag from 0 to 115 ms while the saved MCP timeline stayed at 0 ms. Native UI mode selection then sent `interactionMode=self-window` and `hasUnsavedTimeline=true`; legacy Save request count was zero and the live UI remained dirty after the real observation tool refused with `CUA_NOT_FOCUSED`. Product input count and held inputs were zero. Source HEAD was `e604fe1ff8057b94d7ae6ace3e92784f72e99e91`; only the test harness character-input fix was uncommitted, with its exact SHA-256 recorded in the artifact. This is evidence of first-turn dirty preservation and a genuine focus refusal, not a completed guarded CUA edit. No user focus-wait run was started.

## Pending Save acceptance cases

The Save DTO, separate authority and main runtime are implemented and unit-tested. Final Frontend hooks and integrated actual-app execution are still pending. This table defines acceptance boundaries; it does not claim final app validation:

| Boundary | Required observation |
| --- | --- |
| Wrong project, session, run, frame, layout or content revision | No preparation with authority; no project publication |
| Direct tool invocation, denial or pointer permit used as Save permit | No Save dispatch/publication; token pools cannot substitute for one another |
| Repeated non-consuming permit checks | Original issue time and evidence remain unchanged; final consumption still happens once |
| Renderer repeats an identity string with different live timeline bytes | Main canonical parsing/hash rejects the changed snapshot |
| Project changes while Save waits behind an existing mutation | Final publication guard rejects the changed baseline |
| Cancellation before final publication | No replacement of project.json; temporary preparation files are cleaned |
| Cancellation races the rename/publication call | Await the real storage promise and readback; distinguish persisted-after-cancel from unknown outcome |
| Successful disk write followed by late cancel, UI timeout or window loss | Preserve confirmed persisted receipt; never report a failed save or retry the write merely because UI observation failed |
| Live editor changes while the approved snapshot is being saved | Persisted and current revisions remain distinct; current edits stay dirty and Undo history survives |
| Wrong, late or replayed ready/commit acknowledgement | Cannot grant authority, change the stored receipt or clear another revision's dirty state |
| Concurrent duplicate approval/dispatch | At most one publication; return the existing settled receipt or an explicit replay refusal |
| Fresh explicit observation after input | New content identity is bound before the Save proposal; never rebind an old approved input frame |

“No publication” means the authoritative project file is unchanged. An approved operation may have prepared a temporary file before its final guard; that must not be described as literally zero filesystem writes. Pointer and Save time limits remain separate, main-owned and finite; waiting for UI acknowledgement or a storage queue cannot reset either clock.


## Coordinated final-app launch handoff

Do not start a focus-wait run until the coordinator supplies the final Frontend content-counter/preparing-ACK/Save-hook commit and arranges the user selection. Normally merge that pin with the Backend and agent branches, record `git rev-parse HEAD` and clean `git status --short`, and rerun root typecheck/tests/build and mobile typecheck before launching. The temporary `content-revision-unavailable` implementation is failclosed and cannot establish input success.

From the repository root, after that coordination:

```sh
CUA_AGENT_EVIDENCE_DIR=/tmp/openscene-cua-agent-final-check \
CUA_AGENT_SCENARIOS=deny,stale,duplicate,save-deny,move-save,cancel \
CUA_AGENT_WAIT_FOR_FOCUS_MS=60000 \
node_modules/.bin/electron scripts/cua-agent-app.integration.mjs
```

The harness creates a new isolated userData profile; it does not reuse a user's projects. The expected title is `OpenScene`. The isolated test process has previously used window ID 1, but the actual emitted `waitingForUserSelection` JSON is authoritative for the new window ID/title. Select that test window once when this JSON appears, after fixture creation, editor opening and explicit self-window-mode selection, before the first guarded observation. The wait is bounded to 60 seconds. No production refocus, focus-check override or OS-wide input is permitted. A selected window that still lacks real focus must fail honestly.

`CUA_AGENT_DIRTY_READ_PROBE=1` selects a separate readonly dirty-first-send probe instead of the full scenarios. Do not set it for final movement/Save validation. It creates a real user-role dirty fixture edit, records actual send mode/dirty arguments and verifies zero legacy Save IPC plus unchanged saved MCP state. Neither that setup edit nor native user-role Undo is product CUA evidence.

Clean HEAD `6c520870218500b3b72503c291a2cef241790085` was tested without focus-wait. Evidence `/tmp/openscene-cua-agent-dirty-6c520/evidence.json` records an empty working-tree diff and harness SHA-256 `74b4eeb9332a3611ae12620ea8eafc68e724335e38ca0f8fe7315519e667d7cc`. The real first send preserved live 115 ms/dirty=true versus saved 0 ms with zero legacy Save IPC. Actual observation refused `CUA_NOT_FOCUSED`; window 1/title OpenScene and contents both reported focus=false, product inputs and held inputs were zero, exit status was 1. This is refusal/first-send evidence only. Fresh verification at this pin: root typecheck/build, mobile typecheck and 26 targeted tests passed; full 231 files/1,515 tests had 1,513 passes and the two known temporary Frontend snapshot failures. No focus-wait or additional repeated focus probe was run.


## Remapped shortcut publication regression (launch blocked)

P1 review at e8eed/98d1 reproduced `saveTimeline=ArrowUp` reaching the legacy save callback from the actual `useTimelineShortcuts` handler with `cuaActing=true` and `isLocked=true`. The reviewer fixture `/tmp/cua562-key-bypass.cjs` bundles that actual hook and stubs React/window; it proves a handler-dispatch bypass, not Electron focus, approved main input or a real disk publication. FE owns the fixed-meaning CUA key correction. Do not launch the vulnerable app or start a focus wait before its fix and attack regressions are integrated.

The isolated app harness now prepares an opt-in `CUA_AGENT_REMAP_SAVE_PROBE=1` path. It sets only persisted shortcut preferences before editor mount, makes a real user-role dirty fixture edit, and selects remap-deny/remap-cancel/remap-key scenarios. Denial/cancellation require zero key input; an approved ArrowUp must actually dispatch before zero legacy Save IPC can count as an input-boundary result. A focus refusal cannot pass that assertion. Saved disk timing must remain unchanged and held inputs must settle to zero. After agent reset, ordinary user-role ArrowUp must still produce the normal Save main acknowledgement and dirty=false, keeping user shortcut customization separate from fixed CUA semantics. This path is prepared and syntax-checked only, not executed or validated. Exact fixed key meaning and Undo/MetaZ remap coverage also require the FE owner's hook regressions; zero Save alone does not prove every intended key effect.


The prepared remap-key positive path now includes an explicit `harness-ui` pointer click on the visible timeline clip before Run once. Evidence labels it `explicit-harness-user-safe-return` with `actualHumanSelection=false`, recording safe focus, selection/live timing, dirty state, input counts and driver binding before/after. This is neither agent permit input nor the human's initial window selection. No `.focus()`, activation, recapture or rebind is added. If the current driver treats this user input as cancellation, if the pending approval changes, or if content changes, the test fails without reusing/retrying that approval. Main still rechecks frame/layout/content on Run once. Consequently this prepared stage may fail on strict input-cancel policy; that is not a positive key validation. Actual VM execution remains owned by Frontend and has not been performed here.
