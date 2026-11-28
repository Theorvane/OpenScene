# #597 local verification

Base: facaf42 (#596), local stacked branch feat/597-desktop-navigation. Approved design plus user follow-up for full-window onboarding. One implementation session, no mobile work, no remote merge or TF restart.

## Result and evidence

- One persistent sidebar owns project creation and folder opening, with per-project rename/close/delete and Settings at the bottom. Removed top project tabs/actions, live workspace creation/menu duplication and old precision project creation controls. The video/result list shares the same sidebar. Native menus preserve keyboard access.
- Natural contains the video/timeline above its single chat; Precision and Nodes show no side chat or assistant toggle. The chat stays mounted while hidden so its draft/session survives mode switches. The existing controller still owns timeline history, playhead and selection.
- Removed CUA driver, action/save orchestrators, tool adapters, IPC/preload channels, overlays, shortcut override and CUA-only observation judgment hooks/tests. Generic structured tool approvals, AbortSignal cancellation, media frame/transcript inspection, REA and manual save/history remain. Generic Jev credential/config modules retain persisted settings but no observation hook or Settings screen is active.
- Project deletion requires confirmation describing actual storage semantics. External folders are unregistered with files preserved; app-storage projects delete their stored copies. Tests use fixtures only; no user project/media was deleted. Failed removal keeps the dialog and shows an error. Closing the last project clears the loaded editor; saved work is prepared before switching/creation/close.
- Onboarding is a native modal dialog covering the full window, with keyboard containment, step/back/skip/complete and updated workflow copy. Browser measurements were exactly (0,0,980,680) and (0,0,1440,1000), with `:modal` true. Next and Skip worked.
- `npm test -- --maxWorkers=2`: 238 files passed, one optional integration file skipped; 1321 tests passed, one skipped. Retired CUA-only test suites were removed with their implementation; generic modal key isolation, focus behavior, save races, REA history and structured approval tests remain.
- `npm run build`: passed, including main/web TypeScript checks and all production bundles. `git diff --check`: clean.
- New regression tests: natural chat retained but hidden in detail modes; project actions/delete failure/confirmation/focus restoration; no exposed CUA runtime/tool/bridge; structured pending approval preservation and cancellation; active provider cancellation followed by a new request. Observed red/green for hidden chat, missing CUA boundary and dialog focus restoration. Sidebar was tested before its module existed, then passed against the implementation.
- Actual renderer with synthetic bridge/video: 0 visible chats in Precision/Nodes, 1 in Natural; exactly one New Project and Settings action; no page horizontal overflow at 980×680. Source video decoded (`readyState=4`), played to 0.24 seconds and paused. Synthetic screenshots are ignored under `.local-runtimes/595-visual/597-*`.
- Restarted native Electron with current main/preload. Reopened the existing project from the new sidebar; observed one create/settings action, shared source lanes, model connection guide and disabled send. Played actual source and paused at 12.3 seconds; no timeline edit or save was performed. Native screenshots contain user media and are excluded from handoff. System theme preference was retained.

## Review and limits

Author self-review only, per user's single-session requirement; independent specification/quality review belongs to the team before integration. No live provider was configured, so this does not establish LLM inference or highlight/ASR quality. The optional real FFmpeg fixture remains opt-in and was not repeated for this navigation/removal change; #595 records its actual MP4 verification. #592 local indexing/RAG remains separate design/proof work, not product implementation.

Integration should apply after #596 and preserve main-process file/credential boundaries, atomic edits, source epochs and late response rejection. Local push403 is still the delivery constraint; sanitized patches are the handoff mechanism.
