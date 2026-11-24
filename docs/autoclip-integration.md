# AutoClip integration

OpenScene includes the MIT project AutoClip as `external/autoclip`, from
https://github.com/zhouxiaoka/autoclip (original upstream).
Pinned version: 1.5.9, commit `39c856b0277cd22e730002f693ca333da1f625ba`.
Initialize with `git submodule update --init --recursive`. No dependency installer
or Tauri/FastAPI/MCP service is started by OpenScene.

## Automatic editing available in the desktop agent

The assistant's shared workflow includes an AutoClip-style evidence → ranges →
preview → approve → edit sequence. The registered read-only `planAutoClipEdit`
tool accepts `projectId`, imported `assetId`, a unique `prefix`, and 1–32 segments:

```json
{"projectId":"PROJECT_ID","assetId":"IMPORTED_ASSET_ID","prefix":"highlights-1","segments":[{"start_time":5.5,"end_time":10},{"start_time":20,"end_time":25}]}
```

Times are seconds in the **original imported asset**, not a trimmed clip or
current timeline. Input order is retained, including deliberate repetitions.
The tool returns validated `operations` for `editProject`, total `durationMs`
and `requiresApproval: true`. It reads but never saves. Existing approval gates
apply when the assistant submits those operations to `editProject`; the entire
batch succeeds or fails atomically. Metadata duration must be known. An existing
track/clip ID collision or out-of-bounds range refuses the plan. A new track at
zero is added; it does not replace other tracks or crop a portrait automatically.
Preview/disable other tracks as needed before exporting. No captions, cover,
publishing or AutoClip score is fabricated.

## External runtime boundary

Bundling source is not installation of AutoClip's Python/model/FFmpeg runtime.
OpenScene can preview segment suggestions supplied by a user, generated from
its actual inspected evidence, or obtained from a separately authorized AutoClip
run. It does NOT run the upstream highlight detector automatically. Its original
CLI `produce`/`run` and MCP server remain optional external coding-agent tools;
read `external/autoclip/docs/CLI_AND_MCP.md` before any explicitly authorized run.
Use an isolated data directory; never inherit accounts, download footage/models,
call paid/cloud providers or start a service implicitly. Paths, argv and upstream
SQLite records are not accepted by the bridge. Untrusted model suggestions are
validated through the same shared edit rules as manual edits.

Mobile does not gain Python/Tauri execution or this desktop-only planning tool.
The pure shared planner can be reused by a future mobile adapter; the assistant
must follow the tools actually available there. Original assets, project storage
and FFmpeg export remain OpenScene-owned. Upstream code is unmodified; retain
its MIT license. Native AutoClip execution/quality is not established by bridge
unit tests. Updates require explicit pin review and integration tests.
