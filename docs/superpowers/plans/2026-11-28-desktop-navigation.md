# Desktop navigation implementation plan

> **For agentic workers:** Use executing-plans inline. User explicitly requires one implementation session; team independent review follows local delivery.

**Goal:** One project navigation shell, natural-only chat and no product CUA runtime.
**Architecture:** App owns project lifecycle and mode state; AppShell owns persistent sidebar and quiet top chrome. TimelineEditor retains common project/history/playback controls. Structured editing tools remain the agent's execution interface.
**Tech Stack:** Electron, React, TypeScript, Vitest.
**Spec:** ../specs/2026-11-28-desktop-navigation-design.md (approved by user: ㄱㄱ)

## Global constraints
- Desktop only; local stacked branch from facaf42 (#596), no remote integration.
- Keep security boundaries, provider-required guide and atomic timeline/history.
- Do not delete user projects/media during verification.

## Review focus
- Failed save/open/delete must retain recoverable state and show an error.
- Changing modes hides chat without losing its draft/session.
- Deleting the active project clears its UI; closing and deletion differ.
- No CUA tools/IPC/runtime remain callable; ordinary tool approvals/cancellation remain.
- Narrow desktop windows and light/dark themes retain usable controls and overflow.

### Task 1: Single project navigation and mode-specific content
Files: App.tsx, AppShell.tsx, new ProjectSidebar.tsx and desktopNavigation.css, TimelineEditor.tsx, ProjectSettingsDialog.tsx.
Interfaces: AppShell receives project summaries, active project, busy state and lifecycle callbacks. App retains saved-project controller and deletion behavior. Inline AgentChatPanel mounts persistently and is hidden outside Natural.
- [x] Add failing renderer test asserting one create/open/settings action, visible project menu, natural-only chat and retained draft across mode changes.
- [x] Run focused test and observe missing layout behavior.
- [x] Implement sidebar, project row menu/dialog actions and quiet chrome; remove duplicate project rail/new-video actions.
- [x] Verify renderer behavior, errors and root typecheck; commit coherent shell change.

### Task 2: Remove product CUA paths
Files: main/index.ts, agentChatTools/Graph/Session, preload/index.ts, shared ipc/agentChat, renderer chat/editor hooks, CUA-only modules/tests.
Interfaces: createAgentChatTools(instance) exposes structured editing only; session cancellation remains AbortSignal-driven. Preview/analysis tools stay.
- [x] Add failing boundary test asserting no exposed CUA tools or preload/IPC/driver registration.
- [x] Remove CUA runtime, tool adapters, bridge endpoints, overlays and CUA-only UI/fixtures; update common contracts and tests for structured-only edits.
- [x] Verify cancellation/approval/history tests and typecheck; commit removal.

### Task 3: Review and local validation
- [x] Run full root tests and build, inspect synthetic UI and native app layouts; no real provider or media mutations.
- [x] Self-review spec/quality under single-session instruction; record limitations and sanitized handoff for team integration.
