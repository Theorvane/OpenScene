# Canvas workflows

Canvas assembles imported media using typed function blocks. A graph describes processing; the saved timeline remains the sequence used for preview and export.

## Build an edit

1. Import assets in **Sources** and add source clips, or start with clips already on Timeline.
2. Select source checkboxes and choose a **Quick start**, or add individual **Blocks**.
3. Choose inputs with dropdowns or Output → Input. Complete every input of the output branch.
4. Adjust settings and choose **Final workflow output**.
5. **Apply workflow**, then **Review timeline**. Save and export the reviewed cut.

An empty quick-start selection uses matching clips by start time across tracks, using preserved input times when available. Equal start times retain track/clip order. Explicit selection order is retained. Quick starts select between one and eight matching clips per joined/mixed input set; picture in picture needs exactly two videos.

| Quick start | Connections |
| --- | --- |
| Quick highlight | Selected video sequence → first up to 10 seconds → vivid colour. |
| Video with music | Video sequence → mute embedded sound; selected audio → mix if needed → volume 0.25; combine both branches. |
| Picture in picture | First selected video as background, second as inset. |
| Voice and music mix | Selected audio → mix if needed → volume 0.5. |

These are mechanical starting configurations. Quick highlight does not perform semantic highlight detection; Video with music does not automatically duck music beneath speech.

## Blocks

All time settings below are milliseconds. Video ports include clips placed on video tracks, including supported still images. **Media** accepts video, audio or a combined branch; **Picture** accepts video or a combined branch while preserving separate audio.

| Block | Inputs → output | Settings |
| --- | --- | --- |
| Join videos | 2–8 video → video | Input order determines sequence order. |
| Join audio | 2–8 audio → audio | Sequential lanes preserve track mix. |
| Mix audio | 2–8 audio → audio | Inputs start together; lanes preserve mix. |
| Video + audio | Video + audio → combined | Length follows the longest branch. Original video sound remains unless muted. |
| Trim range | One Media → same type | `startMs`, `endMs`; end 0 means input end. Choose a nonempty range containing media. |
| Change speed | One Media → same type | `rate` 0.25–4; sound follows the picture. Resulting per-clip speed must also remain supported. |
| Start later | One Media → same type | `delayMs` 0–7,200,000. Inserts a leading timeline offset. |
| Colour look | One Picture → same type | original, monochrome, vivid, soft, dramatic or faded; strength 0–1. |
| Set volume | One Media → same type | `volume` 0–1 on all lanes. |
| Transform picture | One Picture → same type | Scale 0–2, X/Y ±10,000px, rotation 0–360°, opacity 0–1. |
| Picture in picture | Two video → video | Inset scale, X/Y and opacity; inset is above background. Defaults: scale 0.35, X 180px, Y 80px. |
| Mute video sound | One Picture → same type | Video-lane volume becomes zero; separate audio lanes remain. |

Trim bounds are 0–7,200,000ms. The catalog supplies defaults and bounds to both interfaces and capability discovery. Graphs allow at most 64 blocks and eight inputs per block. Missing inputs, type mismatches, cycles, invalid settings and unsupported resulting timelines are refused. Reconnecting an upstream input also checks affected downstream port types; disconnect incompatible consumers before changing the branch type. One source ID cannot appear twice in a final output; duplicate the clip in Timeline first.

## Apply and original inputs

Apply materializes the selected output from time zero, including explicit delays. It consumes every source in that branch, even clips completely excluded by a trim. Unconnected timeline clips and titles retain their positions. Other content can therefore extend the total export beyond a branch's displayed duration.

Processing preserves original source ranges and effects in graph metadata. Reapplying evaluates those inputs, so changing speed from 2 to 1 does not halve an already shortened result again. Source files remain unchanged. Newly added source IDs are available alongside preserved inputs. If new clips occupy space freed by a trim, their snapshot uses a separate source lane so both original ranges remain valid; this does not move those clips in the edited timeline.

After deliberately editing input ranges or effects on Timeline, choose **Refresh inputs** to take those current values as the new baseline. This changes what later graph evaluations use and can be undone. Pure join/mix graphs retain their earlier compatibility behavior until an input snapshot is captured.

**Apply block** applies an intermediate output. Editing parameters, removing a connection or arranging nodes changes the graph; it does not automatically reapply the result or render a file.

## Arrange nodes

Source **Use** checkboxes also select sources for arrangement. Block **Select** checkboxes add blocks to the selection. **Clear node selection** clears both.

| Arrangement | Behavior |
| --- | --- |
| Input → output / Auto arrange | Places sources before dependent blocks, grouping dependency depth into columns. |
| Grid | Packs nodes in rows of four, allowing for parameter-panel heights. |
| Align left / Align top | Aligns selected nodes to the smallest selected X/Y coordinate. |
| Space horizontally / vertically | Distributes selected nodes using node dimensions and at least 48px gaps. |

An empty selection arranges all nodes. Auto arrange always arranges the whole graph. Layout changes are saved with the project and can be undone. They do not change connections, source times or media settings. Extremely large arrangements are refused rather than silently clamped into overlapping positions; select a smaller group or use a grid.

Desktop and mobile support card positioning, zoom and Fit. Mobile uses a graph viewport with drag/pinch navigation, a floating add/library button and contextual bottom sheets. Enable multi-select to select sources/blocks; open Canvas actions for arrangement. Native touch behavior requires development-device validation.

## Agent access

The same functionality is exposed through capability discovery and `editProject` batches, including `canvas.template`, `canvas.add/configure/connect/apply` and `canvas.layout`. Agents use opaque clip/block IDs and bounded parameters. See [agent tools](hybrid-ai-editor-direction.md) for examples and approval rules.
