# Provider connections and explicit model selection

User authorized on 2026-11-28: remove apparent built-in local LLM support; connect through Ollama and other providers, using Orca provider/model settings as a reference. If no LLM is connected, show a connection-required message and do not configure or automatically choose a model.

The existing app already invokes Ollama over HTTP, but advertises a permanently connected local engine and hardcoded Qwen/vision/quantization choices. Replace those assumptions with explicit provider connection, discovered models and an explicit user selection. Do not embed, install, start, pull or delete LLM runtimes/models. Local Whisper transcription and FFmpeg remain independent tools.

Reference inspected: installed Orca app static renderer code, especially source-control-ai-model-selection (provider/host-scoped discovered models, remembered explicit selection and discovery freshness) and runtime-provider-accounts-client (connection/error states and bounded listing). Reuse the interaction pattern, not Orca credentials, account data or implementation code. Cloud credentials remain in OpenScene main-process safe storage.

Ollama: user supplies an HTTP(S) endpoint and clicks Connect/Refresh. Main probes /api/tags and /api/show using timeouts, bounded responses and no redirects, returning only model names and declared capabilities/context. Show actual discovered models and capabilities; never offer hypothetical installed sizes/quantization settings. Changing/disconnecting the endpoint invalidates prior discovery. Stale discovery results cannot populate another connection.

Cloud providers retain their existing explicit API key/ChatGPT authorization. Provider connections and model selection are separate actions. Connected providers can expose models, but no model is automatically picked, including on first launch or when a stored model disappears. Preserve supported stored selections without silently substituting a different model. Unknown IDs must fail rather than fall back to Ollama.

Natural editing, precision and node views use the same provider/model preference and chat controller. With no selected, connected, tool-capable model, disable chat submission and show an actionable connection/model selection message plus Settings entry. Preserve compatibility identifiers and safe-storage boundaries. Desktop only; single implementation session.

Verify: empty configuration has no model; disconnected/empty Ollama cannot send; valid discovery filters by declared tools/vision; endpoint changes reject stale results; unknown model IDs fail closed; explicitly selected provider-native IDs reach the correct adapter; no implicit model installation or provider use. Run root tests/typecheck/build and inspect Settings/chat UX.
