# Test Notes

Core checks:

```bash
npm run typecheck
npm test
npm run build
cd mobile
npm ci
npm run typecheck
```

Vitest uses `tests/**/*.test.ts` with a Node environment. Target stores, project/graph validators, timeline rules, canvas processing/templates/layout, atomic editing and registered tool dispatch when touching those areas. Initialize the OpenCut submodule first.

Media tests require executable FFmpeg/FFprobe; the Linux environment in `docs/media-analysis-environment.md` tests committed HEAD without skipping Windows-restricted cases. Verify real frames/audio, source ranges, delay/speed, Apply/reapply, saved layout and Undo for changed media workflows.

Manual checks remain necessary for OS permissions, UI interaction and mobile native exports. Mobile typecheck is required but does not replace a development-client run. Scripted tool calls do not prove a model conversation. For docs-only work, check links, stale feature claims and existing documentation-sensitive tests; do not invent new runtime evidence.
