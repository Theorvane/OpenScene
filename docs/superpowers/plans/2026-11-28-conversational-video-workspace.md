# Conversational Video Workspace Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this session. User requires a single implementer.

**Goal:** Make natural, precision and node editing views of the same project, with shared playback UX and requested-only shorts creation.
**Architecture:** Keep useTimelineEditor as the edit owner. Lift view selection to App so the shell renders exactly one chat surface. Reuse ProgramMonitor and TimelineCanvas in natural mode. Add validated agent adapters over the existing durable ShortsService and a result list over its job/export references.
**Tech Stack:** Electron, React, TypeScript, Vitest, FFmpeg.
**Spec:** ../specs/2026-11-28-conversational-video-workspace.md

## Global Constraints

- Desktop only; mobile suspended. One implementation session, team integration later.
- Preserve CUA protected/safe boundaries, IME guards, source epochs and late-response rejection.
- Preserve original media and separate editing/export approval; no implicit downloads or new service runtimes.
- Stacked local branch on 5fd4190 because prior local work is required and remote push is denied.

## Review Focus

- Switching modes preserves unsaved timeline, selection, playhead and history.
- Hidden monitors never play; only one composer and project toolbar are visible.
- Failed/unfinished exports are not reported as playable completed MP4s.
- Job status survives restart and partial failure; no duplicate result entries.
- Project switches and late job responses do not replace another project's UI state.

### Task 1: Shared editor presentation

Files: App.tsx, AppShell.tsx, AgentChatPanel.tsx, editor/TimelineEditor.tsx, editor/ProgramMonitor.tsx, workspace/WorkspaceShell.tsx, editor CSS.
Interfaces: controlled editor view in App; ProgramMonitor(editor) and TimelineCanvas(editor) share existing controller.
- [x] Add meaningful regression coverage for natural and precision rendering the same monitor/transport and one chat, then confirm failure.
- [x] Lift mode state; remove default candidate/intake flow; use common monitor, track timeline and real chat.
- [x] Consolidate save/undo and active automation stop. Preserve node apply semantics and explicit pending workflow state.
- [x] Verify targeted tests and typecheck.

### Task 2: Requested shorts agent workflow

Files: main/openVideoMcpServer.ts, main/index.ts, main/agentChatTools.ts, agent prompt, new main/shortsAgentTools.ts; tests for adapters.
Interfaces: typed ShortsService adapters start/get/list/materialize/export/cancel; read-only job observations are explicitly allowlisted, all starts/writes retain approval.
- [x] Add failing tests for unavailable service, safe DTOs, validation, job lifecycle and mutating classification.
- [x] Register tools over existing services and describe bounded requested-only workflow in the agent prompt; no frontend keyword dispatch.
- [x] Verify adapters and existing shorts service tests.

### Task 3: Durable video results list

Files: editor/VideoResultsList.tsx and result model/tests; existing export bridge actions.
Interfaces: list/get shorts jobs, getExportJob, open/reveal export; click result opens its editable project and completed MP4 inspection.
- [x] Test project scoping, stable result identity and export completion requirements.
- [x] Add originals/results list with progress, errors, retry-safe refresh and cancellation; reject stale scoped responses.
- [x] Verify focused tests and root suite/build; exercise startup, mode switching and actual local playback.

### Final review and delivery

- [x] Self-review with spec and fresh diff; user disallows parallel agents, independent team review remains before merge.
- [x] Run root typecheck/test/build, record evidence and practical configured-provider limitations.
- [x] Commit local branch and prepare sanitized patch/evidence for Orchestrator item168; no shared integration or merge.

Execution: completed inline. Additional approved scope consolidated chrome/settings and mapped the entire shell to the document theme. See the validation note. Independent team review and shared integration remain pending by user direction.
