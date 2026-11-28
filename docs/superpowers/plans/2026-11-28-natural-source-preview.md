# Natural Source Preview Implementation Plan

> Execution: implement inline in this session only, as requested by the user.

**Goal:** Inspect an imported video in natural mode without creating edits.
**Architecture:** Shared source choice/duration helper, desktop source player and seek bar in the natural host, mobile library source preview.
**Tech Stack:** TypeScript, React, React Native, existing media adapters.
**Spec:** docs/superpowers/specs/2026-11-28-natural-source-preview-design.md

## Constraints
Preserve originals, typed playback URLs, saved timeline, explicit analysis start, compatibility keys. No new dependencies.

## Review focus
Canceled import retains preview; missing metadata uses decoded duration; project/asset changes reset player; hidden players pause; unsupported codecs expose an error.

## Task 1: Source preview
- [x] Add failing shared-rule and mounted player tests for source selection, metadata fallback, seek synchronization, switching and errors.
- [x] Implement shared source helper and desktop preview; mount after import and on reopen without completing intake or changing timeline.
- [x] Add mobile library preview with existing player and shared helper.
- [x] Run focused tests, root typecheck/test/build and mobile typecheck; exercise desktop UI. Record mobile client availability.

User addition: enter natural editing directly at startup, skipping the project selection screen. Desktop supports empty intake and creates a local project only when importing. Mobile starts in Agent for the latest local project, or a new empty project. Project management remains available on demand.

Verification and limits: ../specs/2026-11-28-natural-source-preview-verification.md. Review performed by this session only; independent review required before merging.
