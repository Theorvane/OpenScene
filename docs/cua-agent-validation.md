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

The entry creates a unique profile and local image fixture, starts the actual built main/renderer, and substitutes only `ChatOllama.invoke` with deterministic model tool calls. Approval, own-sender IPC, driver validation, focus, frame/snapshot checks and input cleanup use production code. The harness records unchanged forwarded `sendInputEvent` calls, distinguishing setup/UI input from product driver input, alongside screenshots, actual model call stages, state transitions and DOM event observations. Fixture preparation precedes startup; it never changes editor state to simulate an edit. MCP creates the clip and verifies the saved state. CUA move/selection is followed by the actual Save UI and application Undo menu, then another MCP query.

`CUA_AGENT_SCENARIOS=deny,stale,duplicate,save-deny,move-save,cancel` selects prepared scenarios. A successful run is not established until all selected assertions pass. Denial and intentionally mismatched frame IDs must dispatch zero product inputs. Move-save requires one product pointer-down, a separately approved live Save receipt with diskMatches/uiApplied, and the actual model tool loop reading changed saved MCP timing. Native target-window Undo and menu Redo/Undo are recorded separately; explicit user-role Save then verifies the restored disk timeline. Save denial preserves dirty live edits and performs no publication. Mid-drag cancellation awaits the real driver promise, including rollback acknowledgement and physical release, requires successful cleanup and zero outstanding recorded inputs, and verifies unchanged saved timing. These prepared scenarios are not evidence that they have passed on the final integrated app.

The setup selects only its own test app once with `app.focus`, `window.focus` and `webContents.focus`. It never changes or retries production focus policy. With explicit coordinator/user arrangements, `CUA_AGENT_WAIT_FOR_FOCUS_MS=60000` allows up to one minute for the user to select the identified test OpenScene window. Missing focus otherwise produces an actual observation-tool refusal and nonzero process exit. No debug port, remote control service, paid model call or production startup hook is added.

Save is a separate, human-assisted test action: the harness clicks the existing protected header button in its user role, observes the unchanged `project-timeline:save` handler's successful main-process response, then requires the dirty asterisk to clear before querying MCP. This does not prove an agent can save autonomously. The current CUA driver cannot target that protected header or invent a saving shortcut. Undo first verifies the restored live clip geometry; a subsequent explicit Save and main acknowledgement make that restoration visible to the saved-state MCP query. Save failures or a remaining dirty marker fail validation rather than treating the older saved snapshot as the current UI.

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

The Save DTO and runtime are still being coordinated. These are acceptance cases for the separately approved capability, not claims of implemented or passing tests:

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
