# Upstream pins

## rea-video audit resources

https://github.com/JuneYaooo/rea-video at exact commit
`c11f1bd8fd3edd26a40e8f45be828be685417700`. Included LICENSE/NOTICE/pyproject
bytes and SHA-256 are recorded in `resources/rea-video/UPSTREAM.json`.
This is an attribution/dependency snapshot, not an installed upstream Python runtime.

## OpenCut

The editor presentation submodule is external/opencut from https://github.com/Theorvane/OpenCut.git at commit 56fd309f648b129db3348728ba90a825cbaebc04.

OpenScene owns the timeline model, editing rules, project storage, source inspection, assistant and FFmpeg export. Updates to OpenCut are reviewed before changing the pinned submodule.

## FFmpeg skill

The MIT `external/ffmpeg-skill` submodule from https://github.com/kajisho5/ffmpeg-skill.git is pinned at commit 3145261a1c19f399b9520fad7fdac741871e1426. Its version and hashes are recorded in .agents/skills/ffmpeg-skill/UPSTREAM.json.

## Speech transcription

scripts/install-transcription-runtime.ps1 pins the whisper.cpp executable and model downloads and verifies SHA-256 before use. Downloads live in ignored .local-runtimes storage.

## Verification

Run root typecheck, tests and build, plus mobile typecheck. Check a real imported video through mode switching, clip connection, saving and reopening after editor changes.

## AutoClip

`external/autoclip` from https://github.com/zhouxiaoka/autoclip.git, MIT, version 1.5.9, pinned at `39c856b0277cd22e730002f693ca333da1f625ba`. See docs/autoclip-integration.md for the read-only planning bridge and approval/runtime boundaries.
