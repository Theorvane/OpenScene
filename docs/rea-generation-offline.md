# REA generation: offline dependency 1

This dependency supplies the shared one-shot plan contract, main-only hashing,
durable approval consumption and a fixture-only MiniMax H3 protocol adapter.
It does **not** mount a generation UI or enable generation on desktop or mobile.
`paidExecutionAllowed` remains false. There is no HTTP transport, credential
reader, upload, download, model execution or provider account probe in this change.
An adapter result is `remote-succeeded`, never proof of a verified local asset.

## Fixed protocol and evidence

Official static documentation was fetched on 2026-11-27:

- https://platform.minimax.io/docs/guides/video-generation.md
- https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json
- https://platform.minimax.io/docs/pricing/overview.md
- https://platform.minimax.io/docs/m-plan/faq.md

The OpenAPI SHA256 is
`3aecabd65a846412637bb0f482a69885f902355fc5a514682201858986095171`,
identical to the planning handoff. The adapter is independently implemented from
the public wire; no upstream implementation source was copied. Existing pinned
submodule licenses and notices are unchanged.

Only global `https://api.minimax.io`, `MiniMax-H3`, 768P, integer 4–15 seconds,
and `generate_audio=false` are accepted. Text-to-video has an explicit concrete
ratio. First-frame image-to-video uses `adaptive`, one main-resolved PNG/JPEG
bounded to 5 MB, and bytes matching the approved SHA256. This dependency's byte
fixture is not an image decoder or production media validator.

POST `/v2/video_generation` sends `response_format=task`. GET uses
`/v2/query/video_generation/{task_id}`. DELETE uses
`/v2/video_generation/{task_id}` with no body. Exact own task ID and matching
`action`/`status` are required. A queued-to-completed race can return `deleted`:
that is recorded as deletion and unknown outcome, never cancellation or refund.
Running tasks receive no DELETE. Provider error text and result URLs are dropped.

The estimate is USD 0.08 per output second, dated 2026-11-27; the approved scope
has zero or one reference image. It is an estimate, **not a guaranteed billing
cap**. Unknown cost and legacy `apiKey`/`acceptUnknownCost` fields are rejected.
The reserved credential slot is `minimax-video-payg`; no chat or M Plan credential
is reused, and this dependency never queries credential values or status.

## Durability and boundaries

Plans bind project, asset, source epoch, review version, one shot and timing,
exact final prompt, reference image identity/hash/size, provider/base/model,
resolution/audio/duration/ratio, dated estimate, budget and transmission manifest.
The approval is a random one-use token; only its hash is stored. It expires after
five minutes and is durably consumed before POST. Mutations serialize in a single
main-process owner. Concurrent stores/processes for one directory are unsupported;
the future app lifecycle must own exactly one instance.

Writes use exclusive 0600 temporary files, file sync, atomic rename and directory
sync. Persisted `submitting` recovers as `outcome-unknown`; it can never POST again.
A returned task ID is retained in the current owner's memory if persistence or
observation fails. It is durable only after a successful replacement of the job
store. If both the queued write and the subsequent unknown-outcome write fail,
restart sees the previous durable `submitting` record and recovers to
`outcome-unknown` without a task ID. It still cannot POST again; recovery then
requires explicit provider-side reconciliation outside this disabled workflow.
GET attempts are persisted before observation, with exponential backoff capped at
30 seconds, 120 requests and a 30-minute total deadline. Every fixture transport
request has a 10-second timeout and 256 KiB response acceptance limit. Production
streaming byte limits must be enforced while reading by the future transport.

## Remaining dependent work

1. Production transport and secure slot status/set/clear with own-window/main-frame
   IPC validation, lazy main-only key DI, and a still-disabled paid execution gate.
2. Main-only result URL policy, DNS/redirect/stream bounds, real FFmpeg validation,
   atomic generated-asset provenance, cleanup and late-result isolation.
3. Mounted desktop REA subpanel and mobile unsupported-capability explanation,
   explicit review, local playback and local assembly review, followed by current
   project/source/track-validated ordinary history import with Undo and no save.

No claim about live account access, successful remote generation, real media
download, assembly, UI mounting or timeline import follows from these fixtures.
Independent specification/code review and CI are required; do not ready or merge
this draft automatically.
