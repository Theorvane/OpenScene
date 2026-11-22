# OpenScene mobile

OpenScene mobile edits supplied media through **Edit**, **Canvas**, **Library** and an editing assistant. It shares timeline and workflow rules with the desktop editor.

## Editing

Edit refines clips, tracks, effects, keyframes, titles and captions. Canvas fills the workspace with source/block cards and typed wires. Pan the graph, pinch or use zoom controls, drag card headers to move nodes, and use Fit for an overview. Graph changes become timeline edits when applied.

The floating **＋** opens a bottom library with Quick starts, 12 Blocks, Media and Layers. Tap a node to edit connections and parameters in a contextual bottom sheet. Output ports followed by input ports connect cards; compatible source choices are also available in the sheet. Use the selection tool for multi-select, then **Canvas actions** for flow/grid/alignment/spacing. Positions are saved with the shared project and can be undone/redone. The bottom output bar applies the workflow; **Review timeline** opens Edit.

Processing keeps original input ranges so repeated application is stable. Refresh inputs explicitly adopts the current timeline. Imported media and earlier project metadata remain readable. See [canvas workflows](../docs/canvas-workflows.md).

## Assistant and privacy

The assistant can discover capabilities, inspect the timeline/graph, apply the 34 shared batch editing operations and start native export through approval. Approved batches save once after validation; a rejected batch changes nothing. Chat-based source frame and speech inspection remain desktop capabilities.

The chosen provider receives authorized chat/project context and can charge the user's account. Credentials use platform secure storage. Anonymous usage counts go to the publisher's OpenPanel instance; the Settings switch disables reporting. Event values cannot contain prompts, paths or credentials.

## Develop and verify

```sh
cd mobile
npm ci
npm run typecheck
```

The native export module requires an Expo development build; Expo Go cannot load it. AVFoundation renders on iOS and Media3 on Android. Rendering and Photos/share delivery are separate outcomes. Mobile supports automatic-caption burn choice; separate subtitle sidecar delivery remains unavailable.

Follow [native setup](README-native.md) and repeat edit → canvas apply → review → export on a development device. Desktop tests and mobile typecheck do not replace device validation. [RELEASING.md](RELEASING.md) covers packaging and store declarations.

The graph UI can be previewed with browser-only native adapters for visual development. That preview exercises shared edits and web rendering, but does not validate native pinch/drag, keyboard handling, secure storage or export on a device.
