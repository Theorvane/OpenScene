# Self-window CUA validation

Backend item31, issue #558. Work started from clean `fdce65209afe784e92774e8c7d1fdd0daaf88e6c`.

The driver binds to the BrowserWindow supplied by the host. It neither discovers nor controls other windows, exposes a debug port, nor sends OS input. Renderer IPC exposes state, safety reporting and Stop; approval permit issuance and action execution remain main-only.

## Actual Electron API probes

Run `node_modules/.bin/electron scripts/probe-cua-input.cjs` for HTML5 drag and set `CUA_PROBE_POINTER=1` for Pointer Capture. `CUA_PROBE_DIR` selects the local evidence directory. The probe uses an isolated BrowserWindow and sends actual webContents input. It does not represent a completed editor scenario.

On this macOS host with Electron 43, HTML5 draggable receives pointerdown, mousedown, dragstart and pointercancel; subsequent sendInputEvent movements and mouseUp do not complete dragover/drop/dragend. The process also did not quit cleanly while native drag was outstanding. Therefore the existing HTML5 drag path cannot be claimed as supported by this driver.

The Pointer Capture variant receives pointerdown, every pointermove, pointerup and mouseup. Injected DOM events have `isTrusted: true`; that property cannot distinguish user input. All 27 injected mouse events reached before-mouse-event synchronously during sendInputEvent. This observation supports a synchronous delivery guard on this tested Electron/macOS version, rather than a claim of universal native input attribution.

Both initial probes reported window/content focus false even after win.focus. Actual input partially delivered regardless, so the production driver explicitly refuses unfocused input instead of relying on delivery behavior. Driver code never automatically focuses the window.

Raw initial evidence: `/tmp/openscene-cua-probe/input.json`, `/tmp/openscene-cua-probe/capture.png`, `/tmp/openscene-cua-pointer-probe/input.json`, `/tmp/openscene-cua-pointer-probe/capture.png`. These are local experimental artifacts, not the required full application evidence.

## Remaining integration evidence

The actual OpenScene scenario (MCP clip creation, CUA selection/move, MCP state inspection, UI Undo) and mid-drag stop/rollback evidence are pending the coordinated Frontend Pointer Events implementation and LLM main approval runtime. Stop must verify renderer rollback before claiming cancellation, since a plain mouseUp can commit a pointer drag. Fresh verification, exact final SHA, CI and independent review must accompany the completed integration.

This capability is Electron desktop-specific. Mobile cannot capture/control a BrowserWindow; the shared DTO and pure coordinate conversion must still compile under the mobile TypeScript configuration.
