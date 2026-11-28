# Desktop-first development scope

On 2026-11-28 the user explicitly deferred mobile support to focus OpenScene
development on desktop PCs: macOS, Windows and Linux.

## Active scope

- Electron main/preload/renderer and reusable rules in `src/shared/`.
- Desktop natural-language editing, timeline/Canvas, local media indexing and RAG.
- Root `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and desktop flow verification.
- Desktop packaging and releases, with existing review and CI gates.

## Suspended scope

The active tree no longer includes the mobile application, Expo/native export
modules, mobile-only tests, mobile CI builds, mobile dependency/typecheck steps,
or App Store/Google Play publishing workflows and listing inputs. PC features
do not need mobile screens, device validation or mobile parity work.

Do not restart mobile implementation, builds, publishing or related agent actions
without a new user scope decision. Existing shared editing rules and persisted
identifiers remain compatible; reusable desktop rules are not removed merely
because mobile once consumed them.

## Preservation and restoration

The latest local mobile implementation is recoverable from Git commit `ab2bd70`
(the parent source-preview work for this cleanup). Its workflows, tests and store
inputs are retained in that history. On this workstation the original local
mobile directory, including ignored settings/dependencies, is also preserved at
ignored `.local-runtimes/mobile-suspended-593`; that copy is not part of the
active build or distribution. Mobile store text is preserved locally under
ignored `.local-runtimes/desktop-focus/store-suspended`.

Future restoration must be a separate reviewed change that explicitly restores
implementation, dependencies, tests, CI and release ownership. Do not reactivate
old store credentials/workflows or rename persisted mobile keystore identifiers
as a side effect of desktop work.

## TF integration

Tracked in #593. This is a local change prepared above source-preview work #591;
the user requested TF ownership of shared project application/integration where
work overlaps. No merge or store action is performed by this cleanup. The #592
media-indexing/RAG design now targets desktop only.

## Local verification

For this cleanup on 2026-11-28: root typecheck/build passed and all 1,565 tests
in 250 files passed with the active `mobile/` directory absent. Removed 75
tracked mobile files, two mobile publishing workflows, four store listing
inputs and 15 mobile-only test files. Mixed tests retain desktop/shared
assertions. CI YAML parses with only `verify`; release YAML parses with
`check`, desktop `build`, and `release`, preserving the macOS/Windows/Linux
packaging matrix. `git diff --check` passed.

The diff was self-reviewed in this session. Remote workflows/runs and protected
branches have not been changed by the local cleanup; TF must apply/review it
before the repository's remote automation is considered suspended.
