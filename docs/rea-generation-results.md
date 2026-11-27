# REA verified local results (dependency 3)

Issue #587 is stacked on #585 / Draft PR #586. This adds the main-only result
collector and a concrete **offline** integration caller. Production execution is
still disabled, with no submit IPC or installed provider HTTP adapter. Native
fixture success proves local integration, not live generation or account access.

## Network boundary

Result URLs remain main-only. Only HTTPS `cdn.hailuoai.com` is accepted, based on
the pinned official OpenAPI examples. There are no wildcard hosts. Unknown
provider CDNs fail closed pending a documented policy update. Credentials,
userinfo, fragments, alternate ports, redirects and non-MP4 MIME are rejected.
IPv4 DNS answers are checked against private/special-use ranges, all answers must
pass, and the selected address is pinned into the HTTPS lookup. The connected
peer must match. IPv6 is deliberately unsupported. No API key, cookies or
authorization header is supplied to a CDN.

The downloader accepts at most 100 MB with a 60-second total deadline and
10-second socket idle timeout, rejects inconsistent content length, and closes
late/stalled responses. Exclusive 0600 temporary files are removed on every
failure. Signed URLs, paths, resolver/provider errors and raw messages never enter
public DTOs, stored job receipts or diagnostics.

## Local media, provenance and review

The collector requires the exact approved plan hash and remote-succeeded receipt,
not a native submit return. It validates MP4 ftyp, probes real dimensions and
duration, requires one silent video at a 768-pixel short edge, enforces the
approved concrete aspect ratio and duration tolerance, and decodes the full clip
with bounded FFmpeg. Only then does the existing atomic asset transaction register
`ai-generation` provenance keyed by the job ID. The recording-only import service
is unchanged. No original is overwritten.

One optional main-resolved PNG/JPEG first frame is limited to 5 MB, decoded from a
private byte snapshot, checked against documented image dimensions/ratio and
SHA256-bound into the reviewed plan. No image bytes/path reach the renderer. A
changed image fails before fixture POST. There are no original video/audio
references, continuation jobs or fallback models/regions.

The local assembly review explicitly trims without speed changes, fits/pads to
1366×768, strips audio and verifies the new output. It is labeled `local-render`,
distinct from `generated` and kept-original source media. The original verified
asset remains in the library. Both use existing main-owned playback URLs; the UI
rejects remote preview URLs.

Import preparation checks verified result ownership, source epoch, existing video
track and playable local asset. The host checks current project/source epoch,
track, placement, open/locked state again immediately before application. A shared
pure rule validates the exact clip-add handoff and merges the asset without
replacing the dirty timeline. The normal history path applies one transaction;
Undo retains prior dirty edits and keeps the registered library asset. No timeline
save is performed. Asset registration persists the asset library on disk, as
ordinary imports do; that is separate from saving an in-memory timeline.

Cancellation retires UI results immediately and aborts active local assembly.
Late completion can leave a fully verified library-only asset if cancellation
arrived during registration, but cannot add a clip or claim remote cancellation.
Temporary media is cleaned. Verified result selection is currently session-local;
registered assets remain durable with provenance. No automatic download, re-POST,
reapproval, timeline insertion or save occurs on restart.

## Actual offline evidence

Tests inject protocol/stream/DNS fixtures and replace HTTPS with a failing network
tripwire. A real local FFmpeg testsrc MP4 exercises approval → one fixture POST →
strict task observation → bounded stream → full decode → generated provenance →
2-second fit/trim assembly → shared import handoff. A real PNG exercises main
reference resolution and a separately approved first-frame fixture POST. The
mounted React host exercises local playback and one real history/Undo transaction
with save=0. URL/redirect/private DNS/rebinding/MIME/size/truncation/error/abort and
late-retirement failures are checked separately. No external submit, upload,
result download, real credential/status read, model download or account operation
was executed.

Local review artifact: `/tmp/openscene-rea-generation-review/local-assembly-review.mp4`
(2.000 s, 1366×768, H.264, silent). Look:
`/tmp/openscene-rea-generation-review/local-assembly-review_sheet.png` was inspected;
all six frames contain the expected moving synthetic color-bar pattern and frame.
This is synthetic media, not a generated MiniMax sample or semantic-analysis proof.

Still required before enabling paid execution: a reviewed fixed-host provider HTTP
transport/lazy secure credential DI and explicit disabled submit boundary, source
identity revalidation at submission, independent review and same-HEAD CI. Live
provider behavior and account access remain unverified and require separate
concrete authorization from the coordinator/user.
