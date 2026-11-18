# ffmpeg-skill integration

OpenScene includes a pinned, unmodified MIT snapshot of
[kajisho5/ffmpeg-skill](https://github.com/kajisho5/ffmpeg-skill), version 3.13.1,
commit `3145261a1c19f399b9520fad7fdac741871e1426`.

## Two different execution surfaces

1. **Repository coding agents** can read `.agents/skills/ffmpeg-skill/SKILL.md`
   and use the bundled 42 Python tools for authorized local media tasks. The
   snapshot includes scripts, MCP server source, templates, references and
   the execution-contract documentation. It is not an npm dependency and no
   installer/postinstall or server auto-start is configured. Python 3.10+ and
   FFmpeg/ffprobe 6.1+ must already be available. Some optional features require
   additional local engines/models; do not install or download them implicitly.
2. **The in-app editing assistants** receive a compact adapted workflow from
   `src/shared/ffmpegEditingWorkflow.ts` in desktop and mobile system prompts:
   inspect real metadata → plan → approved supported edit → check/verify → honest
   report. Their existing tool lists, path boundaries and approval gates stay
   unchanged. The desktop app does **not** execute the external Python tools or
   start their MCP server, and the mobile assistant does not gain timeline or
   export tools just by reading this workflow. A job ID alone is not proof that
   an export completed; unavailable output inspection must be disclosed.

This is a real prompt integration plus a repository skill, not a claim that all
42 tools are exposed to the application's LLM. A future execution adapter needs
its own typed inputs, main-process path authorization, cancellation/time limits,
result imports, capability discovery and tests. Do not add a general shell tool.

## Developer usage

From the repository root, inspect the static tool contract (no media access):

```sh
python3 .agents/skills/ffmpeg-skill/scripts/_contract.py --json --static
```

For an authorized local file, follow the upstream skill's probe → dry-run → edit
→ check → verify workflow. Use a separate destination, never overwrite originals,
and inspect actual output/frames before claiming quality. Dry-run may still
probe media; optional ASR backends can download models unless explicitly managed.
Do not feed untrusted remote paths, arbitrary recipes or unreviewed MCP clients
into the bundled tools. These scripts are not newly security-audited sandboxes.

## Provenance and updates

`UPSTREAM.json` records each copied file's SHA-256; integration tests verify
it and the MIT notice. `SKILL.md`, scripts and references are unmodified. The
upstream npm installer, assets/demos, CI, tests and plugins are intentionally not
copied or executed. The upstream package manifest is retained solely for version
introspection. This directory is not included in the desktop package; only the
adapted workflow is compiled into the app.

For an update, review the upstream diff first, select an explicit commit, copy
the same distribution subset, regenerate hashes and run tests. Do not track
`main` dynamically or replace the snapshot during application startup. Preserve
LICENSE and THIRD_PARTY_NOTICES. Reverting this PR removes the integration; no
project schema, settings migration, provider spending or network service is added.
