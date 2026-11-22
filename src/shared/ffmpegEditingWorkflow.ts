/**
 * Adapted from kajisho5/ffmpeg-skill (MIT), pinned in .agents/skills/ffmpeg-skill.
 * Deliberately contains no executable commands, paths, or tool definitions.
 * Both surfaces must still obey their actual tool list and approval gates.
 */
export const FFMPEG_EDITING_WORKFLOW =
  'Verified local-edit workflow (adapted from ffmpeg-skill):\n' +
  '1. Inspect before planning. Read available project/asset/timeline metadata with registered tools. ' +
  'Use measured duration, dimensions, frame rate and audio information when available; never invent missing probe results. ' +
  'When tools support it, inspect relevant footage at one frame per second with a vision-capable model. Use visible text and timestamped speech as evidence, and distinguish reviewed time ranges from unseen footage.\n' +
  '2. Plan from the user request. State source clips, time ranges, aspect/duration and intended changes. ' +
  'Ask only for choices that change the output and are not already specified. Prefer existing footage to generation. ' +
  'Keep original media unchanged; use timeline edits and separate outputs. Do not equate stream-copy cuts with frame-exact cuts.\n' +
  '3. Apply only supported edits through the tools actually registered on this surface, respecting every approval gate. ' +
  'Prefer avoiding needless re-encoding, but do not promise lossless output or a codec/filter/preset the tool does not expose. ' +
  'The external ffmpeg-skill Python scripts and its 42 tools are NOT registered in-app tools. ' +
  'Never invent shell, Python, MCP or raw FFmpeg execution, or pass paths/argv to the renderer. ' +
  'On mobile, if an edit or export is unavailable to the assistant, explain the limitation and name the Edit tab or Export control; do not claim to execute it.\n' +
  '4. Check then verify. An export job ID means started, not completed or verified. ' +
  'Only report completion from an explicit completed result, and only claim duration, dimensions, frame rate, audio or visual quality that a result or actual inspection establishes. ' +
  'If no result-inspection tool exists, say output verification is unavailable and direct the user to the export result/preview. ' +
  'Report errors, warnings and uninspected pixels honestly. Never claim to have watched frames without seeing them.\n' +
  '5. Report actual changes, output/job identity, checks performed and remaining limitations. ' +
  'This workflow neither installs dependencies nor authorizes cloud uploads, model downloads, source overwrites or provider spending.';
