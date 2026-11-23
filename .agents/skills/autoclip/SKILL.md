---
name: autoclip
description: Evidence-based automatic highlight planning over imported OpenScene media, using the pinned AutoClip fork and approved edit batches.
allowed-tools: getProjectTimeline, watchProjectVideo, planAutoClipEdit, editProject
---

# AutoClip / OpenScene adapter

Read `external/autoclip/skills/autoclip/SKILL.md` and `docs/autoclip-integration.md`.
The complete MIT source is pinned under `external/autoclip` from the organization
fork, not dynamically installed or executed by the application.

For automatic editing, inspect imported asset IDs, measured durations and actual
speech/frame evidence. Propose highlights using AutoClip's `start_time` and
`end_time` **source seconds**, not timeline timestamps. Do not fabricate that
AutoClip or a model has analyzed media. Use the registered desktop
`planAutoClipEdit` tool to validate 1–32 segments and preview operations on a new
track. Review the returned batch, then obtain normal `editProject` approval.
Original media and existing tracks remain untouched. Export is separate.

Python/CLI/MCP tools are NOT registered application capabilities. Do not start
AutoClip services, install dependencies, download media/models, upload footage,
spend provider credits, or reuse another application's credentials implicitly.
Full upstream pipeline use requires separately prepared dependencies, explicit
execution permission and an isolated data directory; see its CLI/MCP guide.
Mobile follows its registered tool list and must not claim desktop preview tools.
