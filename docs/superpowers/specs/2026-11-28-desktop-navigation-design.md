# Desktop navigation and focused editing modes

Approved by user (ㄱㄱ). Supersedes #595's precision/node side-chat and CUA surfaces. Desktop only, single implementation session; shared editing history/project contracts remain intact.

## Intent

Use Orca's navigation hierarchy as a reference: persistent left project navigation, a quiet context bar, content-specific controls and a single settings entry. Natural language is the command surface; precision and nodes provide detailed editing. Remove duplicate creation actions and make project lifecycle actions discoverable.

## Approaches

- Patch each existing header/sidebar independently: smaller initial change, but retains competing navigation ownership and makes duplicates likely to recur.
- One application shell owns project navigation and settings; each editing mode owns only its content controls. Recommended because it establishes a single home for each action while preserving the common editor controller.

The implementation choice is the second approach, based on the user's request to reference Orca and unify the whole layout.

## Layout

Left sidebar: collapsible project list with exactly one New Project action and one Open Folder action in the project section. Each project row offers a menu for rename, close and delete. Settings appears once at the bottom. Selecting a project opens its shared saved editing state without a separate project-picker page.

Top bar: current project title, sidebar toggle, Natural / Precision / Nodes switch. Remove duplicate top project tabs, creation/settings buttons and secondary copies of project identity. A single compact project action area owns undo, redo, save and export, visible only when relevant. Native OS menus retain standard keyboard access and shortcuts; do not render another copy of the menu bar inside the app on macOS.

Natural: video monitor above, one appropriate timeline below the monitor, chat command history and composer at the bottom. Original/result switching and video result list stay reachable without competing project navigation.

Precision: common video monitor plus full timeline, asset tools and inspector. No side chat, assistant toggle or chat resize controls.

Nodes: node canvas, relevant preview and node controls. No side chat or assistant toggle. Applying a graph updates the same project, history and timeline used by other modes. Switching modes preserves drafts, selection, playback context and existing edit transactions.

No LLM: retain connection-required guide and unset model in Natural. Provider connection and model choice remain explicit actions.

## Lifecycle and removal

Expose project deletion through its row menu with a concrete confirmation of the current storage behavior. Do not perform deletion during QA or add any deletion of externally supplied original media. Clear deleted project's open UI state and surface failures. Rename and open/create failures must also be visible.

Remove the in-product CUA driver, observation/action/save orchestration, tool registration, IPC/preload entry points, renderer overlays and CUA-only settings/help/tests. Preserve ordinary chat cancellation, tool approvals, atomic structured project edits, save/undo and input/IME behavior. Remove CUA-specific dependency/code only after tracing references; do not remove video frame analysis or transcription just because they inspect media.

All app surfaces derive colors from the same document theme; no fixed dark workbench palette. Use icons with accessible labels and tooltips for compact controls. Empty states explain the next available action without duplicating the permanent navigation.

## Validation

User follow-up: onboarding fills the complete app window. Use a full-window native modal with step navigation, keyboard containment and skip/complete behavior. Update its descriptions to match natural-only chat and sidebar project management.

Test one creation/open/settings entry, accessible project row actions, deletion state/error handling using fixtures, no chat UI in precision/nodes, draft preservation across modes, and no advertised or callable CUA tool/bridge. Run desktop typecheck/tests/build, exercise synthetic projects and inspect native layouts in light/dark. User media and provider credentials are excluded from test/handoff artifacts. Team integration remains separate; no TF restart or remote merge.
