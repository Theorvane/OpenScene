# Provider Connections Implementation Plan

> **For agentic workers:** Use executing-plans inline; the user requires this session as sole implementer.

**Goal:** Explicit provider connection and model choice; no implicit local LLM/default model.
**Architecture:** Main owns bounded Ollama discovery. The typed bridge returns safe model metadata. Existing provider/context state exposes connected models to a shared explicit-selection controller, Settings and the chat picker. Cloud credentials stay in safe storage.
**Tech Stack:** Electron, React, TypeScript, Zod, Vitest.
**Spec:** ../specs/2026-11-28-provider-connections.md

## Global constraints

- Desktop only; stacked local follow-up to #595. No runtime/model installs, pulls or launches.
- Keep compatibility identifiers, including local_qwen, and existing provider credentials.
- No connected LLM: show a connection-required guide, leave model unset and disable submission.

## Review focus

- No fallback to a local model for empty, unknown or removed selections.
- Endpoint changes/disconnect invalidate discovery and late responses.
- Capability discovery never returns modelfiles/paths/credentials or invents tool support.
- A connection does not automatically select a model or start inference.
- Provider-native names reach the right adapter without losing namespaced model IDs.

### Task 1: Safe provider discovery and canonical model rules

Files: shared/ollamaModels.ts, shared/llmModels.ts, shared/aiDomainModels.ts, shared/llmProviders.ts, main/ollamaDiscovery.ts, main/agentChatModel.ts, typed IPC/preload/index registration.
- [x] Test empty selections, unknown IDs, connection-required semantics, endpoint validation, bounded safe discovery and declared capability filtering; observe failures.
- [x] Implement HTTP(S) tags/show discovery with timeout/size/model-count bounds and no redirect; return allowlisted DTOs only.
- [x] Remove fixed local catalog/precision choices and fallback execution, keeping supported legacy IDs as compatibility aliases rather than automatic defaults.
- [x] Verify focused tests/typecheck.

### Task 2: Provider-first Settings and model picker

Files: LlmProviderContext, AiDomainModelContext, agentModelPickerModel, AgentModelPicker, AgentChatContext, AgentChatPanel, SettingsWorkspace, AppShell.
- [x] Test disconnected/empty and stale discovery behavior before implementing.
- [x] Add explicit Connect/Refresh/Disconnect, safe discovered models and contextual guide; do not auto-select on connection.
- [x] Make Settings and the chat picker use the same explicit preference and connection state; retain chat/IME/approval behavior.
- [x] Verify root tests/build and empty-configuration browser UI.

### Delivery

- [x] Self-review, fresh evidence and sanitized patch/handoff. Team owns independent review/integration; no merge or remote application in this session.
