# Pinned upstream migration audit (#556)

Audit date: 2026-11-24. Initial remote `dev` and this workspace's starting HEAD:
`b8e1f1a27e731d471f40286652441431eeb95fc6`.

## Decisions and provenance

| Submodule | Source after migration | Unchanged commit | Decision |
| --- | --- | --- | --- |
| AutoClip | https://github.com/zhouxiaoka/autoclip.git | `39c856b0277cd22e730002f693ca333da1f625ba` | Original upstream; no fork-only commits found |
| FFmpeg skill | https://github.com/kajisho5/ffmpeg-skill.git | `3145261a1c19f399b9520fad7fdac741871e1426` | Original upstream; no fork-only commits found |
| OpenCut | https://github.com/Theorvane/OpenCut.git | `56fd309f648b129db3348728ba90a825cbaebc04` | Preserve fork by explicit user decision because continued support is required |

GitHub repository metadata identifies `zhouxiaoka/autoclip`,
`kajisho5/ffmpeg-skill`, and `OpenCut-app/OpenCut` as the respective fork parents.
The [AutoClip comparison](https://github.com/Theorvane/autoclip/compare/zhouxiaoka:main...main)
reported ahead 0 / behind 14; the
[FFmpeg skill comparison](https://github.com/Theorvane/ffmpeg-skill/compare/kajisho5:main...main)
reported ahead 0 / behind 38. These are observations, not guarantees about future refs.

The complete advertised fork branch/tag refs are preserved in
[`evidence/fork-cleanup-556/refs.json`](evidence/fork-cleanup-556/refs.json).
Every fork SHA except AutoClip's main was also advertised by its upstream.
AutoClip main is the pinned commit and is an upstream ancestor; direct SHA fetch
also succeeded. Thus the copied topic branches and annotated tags do not represent
independent organization patches. OpenScene's adapters remain in this repository.

Each pin above was fetched directly from the original upstream URL into a newly
initialized, separate bare repository using `git fetch --no-tags --depth=1 URL SHA`.
All three fetches succeeded, including OpenCut for provenance only. OpenCut's URL
and pin remain unchanged. No upstream main revision or package version is adopted.
The FFmpeg skill manifest retains all source-file SHA-256 checksums.
The URL, requested/fetched SHA and command output are preserved in
[`direct-fetch.json`](evidence/fork-cleanup-556/direct-fetch.json).

## Asset inventory and preservation

The read-only inventory used task-scoped `sjungwon03` authentication. It queried
all issues and PRs (open and closed), releases, hooks, deploy keys, Actions secret
names, variables, environments, deployments, artifacts and workflow-run counts.
Both forks returned zero assets in these categories. Secret values were never
requested. The responses and query scope are preserved in
[`assets.json`](evidence/fork-cleanup-556/assets.json), with timestamp and comparison
context in [`comparison.json`](evidence/fork-cleanup-556/comparison.json).
This evidence is intended to be committed to OpenScene, rather than left only in
temporary clone directories. All inventoried Git refs remain recoverable from
upstream; their exact names and SHAs are recorded in `refs.json`.

**Deletion blocker:** Projects V2 metadata could not be read because the task
credential lacks `read:project`. The response is retained in `assets.json`.
Projects must be confirmed empty or preserved with suitable owner authorization
before either fork is deleted. The FFmpeg fork advertises wiki support, but its
wiki Git endpoint returned repository-not-found; no wiki content was retrieved.
AutoClip reports wiki and discussions disabled; FFmpeg discussions are disabled.
No asset is treated as absent merely because it could not be accessed.

## Integration and validation gates

At inspection, PR554 HEAD `e8913aaa3279cb79e5726c2a3dbb6f3651834e9d` and
PR555 HEAD `ee5d900fdd7a368fbcd7d9a4349906f817605aa8` both included
`THIRD_PARTY_NOTICES.md` and `electron-builder.yml`. The migration must integrate
normally from latest `dev` after PR554 and PR555 (or its replacement UI PR).
Recheck open PR ownership immediately before that integration. Preserve the
AutoClip full MIT packaged resource and its notice mapping added by the backend;
changing the source URL must never reduce attribution to a source-only path.

CI and release checkout use `submodules: true`; changing `.gitmodules` supplies
the original URLs without changing checkout policy. Existing clones use
`git submodule sync --recursive` before updating. Fresh recursive clone, root
typecheck/tests/build, mobile typecheck, and package/LICENSE verification remain
required on the integrated exact HEAD. The PR stays draft until eligible for
independent approval; only green required checks and independent approval permit
a normal squash merge to `dev`.

The user's later authorization permits deleting only the two skill forks, after
asset preservation, migration merge and confirmation that remote `dev` no longer
depends on their URLs. Reaudit refs/assets and verify task identity `sjungwon03`,
exact repository `full_name` and `fork: true` immediately before deletion.
Permission refusal is a blocker, never grounds to bypass controls. OpenCut and
all other repositories are outside the deletion authorization. Record deletion
and readback results only after those steps actually occur.

## Preparation verification (before dependency PR integration)

On the starting `dev` plus this migration, root typecheck, all 206 test files
(1,286 tests), root build and mobile typecheck passed. Submodule initialization
retained all three gitlinks. Existing shared Git configuration still contained
the old clone URLs; it was not changed across other worktrees. This preparation
run therefore does not replace the required fresh clone from the final commit,
nor the final integrated HEAD's checks and package/LICENSE inspection.
No editing rule or screen changes are introduced, so no development-client
screen exercise is applicable to this URL/provenance-only migration.
