# Source preview and direct natural startup verification

## Results
- Root typecheck and production build: pass.
- Mobile typecheck: pass after installing locked dependencies.
- Focused regression suite: 9 files, 24 tests pass, including empty startup, first import/folder cancellation, decoded duration fallback, seek/timeupdate synchronization, project URL reset, media/load errors, hidden player pause and existing review draft lifetime.
- Full suite: 1707 passed, 14 failed (1721 total). Thirteen failures require FFmpeg, absent from this machine. The remaining asset-copy concurrency test passed in the focused rerun; no copy code was changed.
- Desktop GUI: direct natural intake and reopened imported video with 17:31.1 full-duration timeline observed. Background GUI seek actions did not provide verification; seek behavior is covered by the mounted player test. Native playback was not independently confirmed end to end.
- Mobile development-client screen exercise not performed; typecheck only.

## Review
Self-reviewed against the approved design and startup addition in this session, per the user’s instruction to use only one implementing session. No independent review or merge claimed. Checked source-only playback leaves the project timeline untouched, local URL lookup is scoped to project and asset, late replies are discarded, and project creation cancellation does not call import. Native controls and range preserve keyboard behavior. Saved/approval boundaries remain intact.

## Full-suite failures
-  tests/assetLibraryConcurrency.test.ts > asset library concurrency > given a same-size source mutation during import, when copy verification runs, then the unstable asset is rejected
-  tests/audioDetachService.test.ts > audio detach service > extracts a real embedded stream through the discovered FFmpeg binary
-  tests/clipColour.test.ts > a rendered grade > actually changes the picture
-  tests/clipSpeed.test.ts > a rendered retime > keeps delayed, retimed low-rate audio mixes at real timestamps and audible after the delay
-  tests/clipSpeed.test.ts > a rendered retime > produces a file of the length the timeline promised, with its sound retimed too
-  tests/ffmpegExportE2e.test.ts > FFmpeg export end to end > renders a v3 timeline to a playable H.264/AAC MP4 through the discovered local binary
-  tests/metadataPrivacyFfmpeg.test.ts > Privacy Clean FFmpeg delivery > removes allowlisted personal tags from the output copy while preserving copyright
-  tests/nativePickerMediaImport.test.ts > native picker media import > returns an empty successful import without persisting assets when the picker is canceled
-  tests/nativePickerMediaImport.test.ts > native picker media import > copies a real MP4 into project storage without exposing or retaining dependence on its source path
-  tests/nativePickerMediaImport.test.ts > native picker media import > imports a PNG selected from the image-only Editing picker as a project image asset
-  tests/nativePickerMediaImport.test.ts > native picker media import > rejects a real MP4 mixed with an unsupported selection atomically and without exposing paths
-  tests/timelineAssetResponse.test.ts > timeline asset response > serves a real MP4 imported through the native picker seam without exposing its source path
-  tests/stillTimelineExport.test.ts > a still on the timeline > renders to a video of the length it was held for
-  tests/timelineTransitions.test.ts > a rendered transition > actually darkens the frame at the cut
