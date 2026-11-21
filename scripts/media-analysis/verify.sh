#!/usr/bin/env bash
set -euo pipefail

# /input is mounted read-only. Work on a Git snapshot with Linux dependencies.
mkdir -p /work/project /results
tar -xf /input/.local-runtimes/verification-source.tar -C /work/project
mkdir -p /work/project/external/opencut
tar -xf /input/.local-runtimes/verification-opencut.tar -C /work/project/external/opencut
cd /work/project
node --version > /results/tool-versions.txt
ffmpeg -version >> /results/tool-versions.txt
ffprobe -version >> /results/tool-versions.txt
ps --version >> /results/tool-versions.txt
npm ci --ignore-scripts --no-audit --no-fund > /results/npm-ci.log 2>&1
npm ci --prefix mobile --ignore-scripts --no-audit --no-fund > /results/mobile-npm-ci.log 2>&1
node node_modules/vitest/vitest.mjs run tests/clipSpeed.test.ts tests/metadataPrivacyFfmpeg.test.ts --reporter=verbose > /results/previously-failed-tests.log 2>&1
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --testTimeout=20000 --reporter=json --outputFile=/results/vitest.json > /results/full-tests.log 2>&1
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json
node mobile/node_modules/typescript/bin/tsc --noEmit -p mobile/tsconfig.json
if [[ -f /input/.local-runtimes/block-workflow-result.mp4 ]]; then
  python3 .agents/skills/ffmpeg-skill/scripts/probe.py /input/.local-runtimes/block-workflow-result.mp4 --json > /results/block-output-probe.json
  python3 .agents/skills/ffmpeg-skill/scripts/look.py /input/.local-runtimes/block-workflow-result.mp4 --tiles 3x2 --no-timecode --output /results/block-contact-sheet.png --json > /results/block-look.json
fi
node -e 'const r=require("/results/vitest.json"); console.log(JSON.stringify({success:r.success,passed:r.numPassedTests,failed:r.numFailedTests,pending:r.numPendingTests},null,2)); if(!r.success)process.exitCode=1'
