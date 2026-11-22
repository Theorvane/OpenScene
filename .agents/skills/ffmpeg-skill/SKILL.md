---
name: ffmpeg-skill
description: Local FFmpeg editing and verification using the pinned organization fork; procedural coding-agent skill, not unrestricted in-app tools.
---

# FFmpeg skill adapter

The complete skill lives in `external/ffmpeg-skill/SKILL.md`. Read that file before
performing authorized local video/audio work, then use scripts and references
relative to `external/ffmpeg-skill`, not this adapter directory.

Initialize a fresh checkout with `git submodule update --init --recursive`.
The pinned revision and SHA-256 manifest are in `UPSTREAM.json` here. Never
silently substitute the fork's latest main branch for the reviewed revision.

The fork is https://github.com/Theorvane/ffmpeg-skill; retain its original MIT
license and upstream attribution. Do not install tools, download models or start
an MCP service implicitly. Preserve source media and check outputs before
claiming completion. The application's assistant still uses only registered
editing tools and approval gates; these Python scripts are not automatically
exposed to it. See `docs/ffmpeg-skill-integration.md` for integration boundaries.
