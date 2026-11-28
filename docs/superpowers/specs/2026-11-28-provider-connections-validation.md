# #596 local validation

Stacked local follow-up to #595 (`f11dcc5`). User authorized this session as sole implementer, desktop focus, explicit provider connections and no automatic model selection. Team review/integration/merge remains pending; no remote application in this session.

- `npm test -- --maxWorkers=2`: 259 files passed, one optional integration file skipped; 1580 tests passed, one skipped.
- `npm run build`: passed, including TypeScript checks and Electron main/preload/renderer builds. Repeated after the final source-track light-theme contrast change.
- Discovery tests cover allowlisted metadata, endpoint rejection, missing declared capabilities, sanitized errors and stale cache results after failure/reconnect. Context tests cover empty startup, explicit connection without automatic selection, endpoint change, late response rejection and disconnect.
- Unknown execution model IDs now fail instead of falling back to Ollama. Namespaced/tagged Ollama IDs map to provider-native names. Compatibility IDs including `local_qwen` remain aliases, not defaults or catalog entries.
- Native Electron was restarted with the current bridge/main changes and the locally configured FFmpeg executable. Reopened the existing saved project; actual source video played and paused. Natural view shows one Settings entry in app chrome, shared playback, source lanes and bottom chat. Without a provider it shows the connection guide, empty model choice and disabled submission.
- Native Appearance/light changed the titlebar, toolbar, sidebar, video workspace and chat together. Restored the original System preference and Graphite preset; returned to the paused natural editor. Native screenshots contain user media and are excluded from handoff.
- Fixed an additional observed folder-picker reentrancy issue: repeated activation cannot open a second dialog while the first is pending. Regression test failed with two calls before the guard and passed after it.
- Light-theme source-track clips now blend their lane colors into the active canvas palette so foreground labels retain contrast.

No live model provider or downloaded LLM was configured for this validation. Discovery/adapters were tested with controlled responses; these checks do not establish real-provider inference, ASR accuracy or highlight quality. #595 separately verified actual synthetic MP4 rendering and reopening. No model installation, pull or runtime launch was added. Optional transcription/FFmpeg tools remain independent of the editing model connection.

Orca reference was limited to installed static provider/model UI patterns; no account data or credentials were copied. Ollama discovery follows the upstream [API documentation](https://github.com/ollama/ollama/blob/main/docs/api.md). Local media-index/RAG design artifacts belong to #592 and are not implemented by this change.
