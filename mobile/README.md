# OpenScene mobile

OpenScene mobile edits supplied media through **Edit**, **Canvas**, **Library** and an editing assistant. It shares timeline and workflow rules with the desktop editor.

## Editing

Edit refines clips, tracks, effects, keyframes, titles and captions. Canvas provides the same 12 blocks and four quick starts, with typed inputs, parameter controls, final-output application and undo. Graph changes become timeline edits when applied.

Source selection chooses quick-start inputs. Workflow controls connect/disconnect inputs, expand join/mix inputs and remove blocks. Node arrangement saves flow/grid/alignment/spacing coordinates for the shared project; the phone displays a compact touch workflow. Free-position cards and viewport Fit are desktop controls.

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
