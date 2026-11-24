# Third-party notices and license inventory

This file records software deliberately used by this fork. It is an engineering inventory, not legal advice. Preserve the upstream `LICENSE` file and all required notices when redistributing the application.

## Application source

OpenScene is used as the application base under the MIT License.

- Project: https://github.com/Theorvane/openscene
- Copyright: 2026 Theorvane
- Pinned source: see `UPSTREAM_PINS.md`
- License text: `LICENSE`

No source from CutAgent, Weave, AutoVio, Velorn, Milimo Video, ComfyUI, Wan, whisper.cpp or LTX-Video has been copied into this repository.

## OpenCut editor source

OpenScene compiles editor components from the pinned OpenCut submodule into its desktop renderer.

- Upstream project: https://github.com/OpenCut-app/OpenCut
- Maintained fork: https://github.com/Theorvane/OpenCut
- Copyright: 2026 OpenCut
- License: MIT
- Pinned source and full license text: `external/opencut/LICENSE`
- Desktop package license text: `licenses/OpenCut-LICENSE.txt`

Keep the OpenCut copyright and MIT permission notice with redistributed copies of the desktop app. The packaged `THIRD_PARTY_NOTICES.md` and license text are included as resources.

## Direct JavaScript dependencies

The installed direct dependencies were inspected from their package manifests on 2026-09-02.

| Package group | Installed license |
|---|---|
| React, React DOM | MIT |
| Electron, electron-builder, electron-updater, electron-vite | MIT |
| Vite, Vitest and `@vitejs/plugin-react` | MIT |
| LangChain provider/core packages and LangGraph | MIT |
| `@theorvane/type-mcp` | MIT |
| Zod | MIT |
| TypeScript | Apache-2.0 |
| `@types/node`, `@types/react`, `@types/react-dom` | MIT |

Before a release, generate and review a complete transitive dependency report rather than relying only on this direct-dependency summary.

## System FFmpeg used for development

The current development machine uses `ffmpeg 9.0.1-full_build-www.gyan.dev` installed through winget package `Gyan.FFmpeg`.

Its configuration includes `--enable-gpl`, `--enable-version3`, `--enable-static`, `libx264`, `libx265` and `libass`. It is a system development dependency and is not copied into this repository. Bundling this build into an installer is not approved by this inventory.

For distribution, choose and document one of these paths:

1. require a user-provided FFmpeg installation;
2. ship a separately reviewed LGPL-compatible build with only the required codecs; or
3. accept the applicable GPL obligations for a bundled GPL build.

## Local transcription runtime

The optional setup script downloads pinned whisper.cpp binaries and model files into ignored local storage. Runtime and model provenance are recorded by scripts/install-transcription-runtime.ps1.

## ffmpeg-skill repository tools and workflow

- Upstream: https://github.com/kajisho5/ffmpeg-skill
- Version: 3.13.1; commit: 3145261a1c19f399b9520fad7fdac741871e1426
- Copyright: 2026 kajisho5
- License: MIT; complete notice: `external/ffmpeg-skill/LICENSE`
- Snapshot provenance and file hashes: `.agents/skills/ffmpeg-skill/UPSTREAM.json`

The repository includes the Python tools and documentation for coding-agent use. The packaged app uses only a compact adapted editing workflow, not the upstream scripts or MCP server. See `docs/ffmpeg-skill-integration.md`.

MIT License

Copyright (c) 2026 kajisho5

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## AutoClip

AutoClip, copyright (c) 2024 AutoClip Team, MIT. Source: https://github.com/zhouxiaoka/autoclip; managed fork https://github.com/Theorvane/autoclip. Pinned source and full license: `external/autoclip/LICENSE`. OpenScene does not automatically execute the upstream runtime.

Pinned version: 1.5.9, commit `39c856b0277cd22e730002f693ca333da1f625ba`. Desktop packages include the complete copyright and MIT permission/warranty notice at `licenses/AutoClip-LICENSE.txt`, alongside this inventory. The local shorts workflow calls OpenScene's shared source-range planner and existing editing/export code; it does not launch the upstream Python pipeline or redistribute its runtime/model dependencies.
