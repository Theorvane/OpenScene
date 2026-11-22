#!/usr/bin/env bash
set -euo pipefail

# Preserve exactly the build being investigated and never replace prior Evidence.
run_directory=$(mktemp -d /results/rea-XXXXXXXX)
cp -a /input/out "$run_directory/artifact"
source_args=(--source-path main/index.js --source-path preload/index.cjs)
while IFS= read -r -d '' bundle; do
  source_args+=(--source-path "${bundle#"$run_directory/artifact/"}")
done < <(find "$run_directory/artifact/renderer/assets" -maxdepth 1 -name '*.js' -print0)
node /opt/rea/node_modules/rea-agents/scripts/rea.mjs analyze-javascript-application "$run_directory/artifact" \
  "${source_args[@]}" --max-semantic-nodes 20000 --max-semantic-nodes-per-file 10000 \
  --max-heap-mb 2048 --analysis-timeout-ms 120000 --detail summary \
  --evidence_output "$run_directory/evidence.json" --json \
  > "$run_directory/summary.json" 2> "$run_directory/progress.log"
printf 'REA Evidence and analysis: %s\n' "$run_directory"
