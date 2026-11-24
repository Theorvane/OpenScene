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

`CUA_AGENT_SCENARIOS=deny,stale,duplicate,move,cancel` selects prepared scenarios. A successful run is not established until all selected assertions pass. Denial and intentionally mismatched frame IDs must dispatch zero product inputs. Move requires one product pointer-down, changed saved MCP timing and one UI Undo restoring it. Mid-drag cancellation awaits the real driver promise, including rollback acknowledgement and physical release, requires successful cleanup and zero outstanding recorded inputs, and verifies unchanged saved timing. These prepared scenarios are not evidence that they have passed on the final integrated app.

The setup selects only its own test app once with `app.focus`, `window.focus` and `webContents.focus`. It never changes or retries production focus policy. With explicit coordinator/user arrangements, `CUA_AGENT_WAIT_FOR_FOCUS_MS=60000` allows up to one minute for the user to select the identified test OpenScene window. Missing focus otherwise produces an actual observation-tool refusal and nonzero process exit. No debug port, remote control service, paid model call or production startup hook is added.

## Intermediate actual-app result

On production source HEAD `310eb0a9fff665989d4ced8e79f33d51ec9175d4` (before final Frontend integration), the isolated actual OpenScene app created a two-second image clip through `mcpExecuteTool(addClipToTimeline)` and verified it through `getProjectTimeline`. The real renderer opened and displayed the clip. Window ID 1 / title `OpenScene` reported both `isFocused()` values false after the one-time setup activation. The synthetic model called the real `observeEditorWindow` tool; it returned `CUA_NOT_FOCUSED`. Recorded product input calls and outstanding inputs were both zero. The harness exited 1, preserving the focus guard.

Local evidence: `/tmp/openscene-cua-agent-app-initial4/evidence.json`, `00-actual-app-before-observe.png`, `actual-product-focus-refusal.png`, and `failure.png` in that directory. The evidence JSON includes source HEAD and the isolated profile. This intermediate execution used the then-uncommitted test script; subsequent harness runs also record its SHA-256 and working-tree status. It establishes a real product focus refusal, not successful CUA move, cancellation during held input, UI Undo, final Frontend integration or live-model quality.

## Verification boundary

At pushed agent HEAD `58a25f499cdc85233b66a170c133c7043ad55323`, root typecheck, 219 test files / 1,387 tests, build and mobile typecheck passed locally. Its `verify`, `ios-module`, `android-module` and `ios-export` CI checks passed; automatic review was skipped for Draft. Later dependency merges and the E2E script require fresh exact-HEAD verification and independent review. The PR must stay Draft until coordinator authorization; no readiness or merge is implied by these intermediate checks.
