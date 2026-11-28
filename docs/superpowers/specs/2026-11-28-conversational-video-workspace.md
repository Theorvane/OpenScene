# Conversational video workspace

Status: approved by the user on 2026-11-28, including consistent playback UX across modes. Desktop only.

Additional user direction: consolidate duplicate project/settings/menu information across the OS/application chrome, workspace toolbar and sidebar. Apply every theme to the full app shell and all editor views, fixing the fixed-neutral token override. Keep native menu keyboard access, one project identity/navigation strip, one settings shortcut, and one project action toolbar; remove the nested editor header.

## Product behavior

OpenScene opens as a general natural-language video editor. The main area shows the selected video above the existing agent conversation and prompt composer. Importing a video makes it available immediately; there is no separate “start editing” step and no default shorts analysis, candidate panel or portrait-only workspace.

The preview supports original footage and the current edited project. After an edit, the user can inspect the resulting timeline rather than unknowingly continuing to watch only the original. Keep one custom playback control set and the existing video/audio/subtitle track presentation. Preserve the precision editor for detailed adjustments.

Use the existing AgentChatContext, model selection, conversation history, cancellation and approval handling. Render one chat surface; the natural workspace must not duplicate the sidebar composer. Ordinary requests such as trim, captions, sound changes or reordering use registered editing capabilities without entering a shorts workflow.

## Requested convenience workflows

When the user requests shorts or highlights, the agent inspects actual available frame/speech evidence and uses the supported AutoClip planning contract. The planner itself does not run the upstream AutoClip detector. Expose the existing durable shorts selection/materialization/export services through validated agent tools where needed, preserving authorization and cancellation boundaries. Do not dispatch jobs from a frontend keyword match.

After approval, create separate editable result projects and render local MP4 outputs through FFmpeg. Show progress, partial failures and cancellation accurately. A created project is not yet a completed rendered video. Do not automatically install upstream Python services, download models or send footage to an unconfigured provider.

## Three views, one editing session

The user requires natural-language, precision and node editing to operate together. They are views of one open project, not independent editors. Retain the existing shared editor controller as the owner of the timeline, canvas graph, selected asset/clip, playhead, dirty/save state and undo/redo history. Switching modes changes presentation without reopening the project, resetting playback position or discarding unsaved work. Pause a hidden media element and allow only the visible monitor to drive playback.

Current disconnect: precision and canvas already receive the same editor controller, while the natural view's SourcePlayer owns an independent clock and displays original footage, alongside a separate shorts workspace. Replace that default with the shared edited-project monitor and shared transport. Source inspection remains an explicitly selected context with source-relative time; never copy source seconds directly into edited timeline time. Return to the previous timeline position after source inspection.

Natural-language approved edits must refresh the same active editor and become visible in precision and node views. Reuse the existing prepare/save and authoritative refresh boundaries; reject late responses for another project/source epoch and preserve the documented history transaction semantics. Never overwrite a newer local draft with a stale saved snapshot. Capture project identity at send/approval and show actionable save/conflict errors.

Precision edits must be visible immediately when returning to natural mode. Canvas reads the same current timeline and graph. Node settings/layout may remain draft workflow state until explicit Apply; explain that state and show its impact. Applying a node workflow uses the existing atomic edit operation, updates the same timeline/preview, and can be undone as one operation. Do not auto-apply a graph merely because the user switches modes or silently refresh away an authored graph. Report outdated source snapshots and offer the existing explicit refresh/review behavior.

An intentionally created shorts result is a separate project, clearly labeled as such; merely selecting a different editor mode never creates or switches projects. The shared save/undo controls always target the currently open project.

## Video list

The video list exposes imported originals and generated editing results. Each result identifies its source and durable job/project/export references. Completed MP4s can be selected for playback and opened or revealed through the existing main-process bridge. Keep raw filesystem paths in the main process. Restore results after reopening the application and avoid duplicate entries on repeated status updates. Failed or unfinished outputs must not appear as playable completed videos.

## One visible control per action

The user explicitly requested that duplicate controls and UI not be introduced. The current workspace header's undo/save/stop actions are not video playback controls: undo calls timeline undo, save persists the timeline, and stop calls the CUA automation stop handler. The visible label “취소” obscures undo and the unqualified “중지” obscures automation stop.

Consolidate project save and undo into one visible project toolbar, including across the workspace shell and embedded editor header. Label undo “실행 취소”. Use the preview's single playback controls for video playback; switching source/result must reuse that transport rather than render a second set. Keep the accessible emergency automation stop available while automation is active or stopping, including recovery/error states that need it, with an explicit “자동 조작 중지” label. Do not replace it with video pause or remove its protected CUA boundary. Show chat/job cancellation with the active request or job and name its target. Avoid simultaneous sidebar/bottom chat composers, duplicate timelines, and duplicate source/result players. Keyboard shortcuts may share the same action without adding visible controls.

Verify each displayed control's handler and state, including dirty/saving, undo availability, paused/playing, active/cancelling jobs and CUA recovery, rather than deleting buttons solely because their icons resemble one another.

## Scope and ownership

Reuse existing editing, shorts, export and conversation services rather than creating a second pipeline. Preserve saved projects and compatibility identifiers, including any migration of the existing persisted `shorts` view value. Mobile work remains suspended. Automatic full-frame indexing/RAG in #592 is separate work and is not assumed implemented here. Work occurs only in this session; shared integration and merging remain with the team after ownership confirmation.

## Verification

Check startup/import without shorts jobs, a normal editing request, previewing the saved edit, requested shorts workflow with approval, cancellation and partial export failure, completed result selection, and restart restoration. Run desktop typecheck, focused meaningful tests and build. Exercise the real application for layout and playback; distinguish configured-provider execution from mocked pipeline verification.

Exercise round trips: precision trim → natural preview → node source inspection; node Apply → precision timeline → natural preview; approved natural edit → both other modes; Undo/Redo across mode changes. Verify the same project ID, timeline revision, selection and playhead survive switching. Cover dirty timeline save failure, project switch during an agent request, stale response rejection and no duplicate active playback/composer/control set.
