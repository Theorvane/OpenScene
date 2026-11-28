# REA generation integration status

Snapshot: 2026-11-28. This is the desktop offline implementation chain, not a live
generation receipt, production-quality assessment or authorization to spend.
The coordinator authorized consolidating the four stages into representative
PR #590 against `dev`, with normal integration, fresh CI and renewed independent
approval before an exact-head squash. The initial base was `origin/dev` at
`199565aff4249873b4ffded9974409b2d93d12a9`; the original stages were stacked.
The former prohibition on owner readiness/merge was explicitly superseded by
this conditional authorization; no bypass, force push or branch deletion is allowed.

## Consolidated integration gate

The actual normal merge integrates dev
`3a9799469b5333f50311eb403c83bd61f6b7ff32` (Jev #568) into the representative
branch. It completed without conflicts and preserves Jev's settings and judgment
changes. A predicted merge tree is not a validation result. The successor to this
documentation commit must receive its own CI and independent integration review;
the approvals below do not authorize a different HEAD.

All original heads are ancestors of representative pre-integration head
`2cfe3c139521bc02a7659fea9db85a12c560e904`:

| Original PR | Independently approved full HEAD | Actual review ID | Same-head CI run (four SUCCESS) |
| --- | --- | --- | --- |
| #584 | `4659bc2bb7bd2692a70ec9e6deee78500cd92434` | 6084730823 | 45952395057 |
| #586 | `86864c3cec26b75181f65c00f918d94a22012cd0` | 6095977995 | 45955791079 |
| #588 | `2bf686ec88a0540691affe0b4fb8674f5c63cc77` | 6096006448 | 46110751084 |
| #590 | `2cfe3c139521bc02a7659fea9db85a12c560e904` | 6095999577 | 46110757499 |

The default Node DNS P2 is fixed in `2bf686e`: `all:true` returns only the pinned
IPv4 address in an array; the single-address callback remains supported. Actual
production HTTPS options are captured without a socket, then exercised through
Node v26.8.2 socket preparation with all IPv4/IPv6 dialing blocked. Old code yields
`ERR_INVALID_IP_ADDRESS`; fixed default/true/false family selection reaches
`ERR_IP_BLOCKED`. This is not Node 22, Electron or live-provider evidence.

Fresh pre-integration local checks passed on #588 (266 files / 1779 tests) and
#590 (267 files / 1787 tests), with root typecheck/build and mobile typecheck.
Fresh integrated checks and public CI remain distinct receipts recorded on #590.
After a conditional merge, original PRs may be closed as duplicates only after
checking the resulting dev tree contains each stage's final product/docs/harness
changes; their original branches must remain intact.

## Historical stage integration and exact CI evidence

The commits below identify the code and CI snapshots actually observed. This
document is a documentation-only follow-up to the stage-4 code commit: its own
successor PR HEAD must receive fresh CI and review before readiness. The table
does not transfer a passing result from an old HEAD to that successor.

| Stage / issue / Draft PR | Observed full HEAD and base | Implemented boundary | Same-HEAD CI snapshot | Remaining review |
| --- | --- | --- | --- | --- |
| 1 / [#583](https://github.com/Theorvane/OpenScene/issues/583) / [#584](https://github.com/Theorvane/OpenScene/pull/584) | `4659bc2bb7bd2692a70ec9e6deee78500cd92434`; base `dev` | Immutable strict one-shot plan/hash/manifest/budget, one-use approval, durable submit/unknown recovery, strict offline H3 protocol | [45952395057](https://github.com/Theorvane/OpenScene/actions/runs/45952395057): verify, ios-module, ios-export, android-module SUCCESS | Reviewer155 independently resolved the task-ID durability P2; formal final verdict requested after CI4 receipt |
| 2 / [#585](https://github.com/Theorvane/OpenScene/issues/585) / [#586](https://github.com/Theorvane/OpenScene/pull/586) | `86864c3cec26b75181f65c00f918d94a22012cd0`; base `feat/583-rea-generation-offline` | Fixed video credential slot and own-window/main-frame IPC, review-only mounted REA panel, safe bounded retention | [45955791079](https://github.com/Theorvane/OpenScene/actions/runs/45955791079): all four SUCCESS | Reviewer156 found retention P2; fix and deterministic/restart/concurrent/fault regressions pushed, latest-pin re-review requested |
| 3 / [#587](https://github.com/Theorvane/OpenScene/issues/587) / [#588](https://github.com/Theorvane/OpenScene/pull/588) | `616d0adc4aa60a4f508a60880053e820f54ed48b`; base `feat/585-rea-generation-review` | Main-only bounded CDN collector, actual MP4/PNG validation, provenance, fit/trim review, local playback and ordinary history import | [45955794534](https://github.com/Theorvane/OpenScene/actions/runs/45955794534): all four SUCCESS | Sequential independent specification/code review requested at this full pin; no verdict claimed |
| 4 / [#589](https://github.com/Theorvane/OpenScene/issues/589) / [#590](https://github.com/Theorvane/OpenScene/pull/590) | `7a5fc68fe2e7050da022423c6fd5e4a1576e2254`; base `feat/587-rea-verified-results` | Fixed global PAYG transport/lazy key DI, main source identity revalidation, disabled submit and concrete gated observation/cancel/shutdown | [45957101697](https://github.com/Theorvane/OpenScene/actions/runs/45957101697): verify, ios-module, ios-export SUCCESS; android-module IN_PROGRESS at observation | Independent specification/code review requested; android completion and latest documentation-successor CI remain unconfirmed |

Public GitHub reviews and threads were empty at the historical aggregate metadata receipt.
Coordinator-delivered independent findings above are separate evidence; an empty
public review list is not an independent approval. No CI was bypassed, no branch
was force-pushed and no PR was self-readied or merged.

## Offline flow and verification

| Step | Actual offline evidence | Current product behavior |
| --- | --- | --- |
| Prepare and approve one exact job | Plan mutation, foreign project, source epoch, prompt/image/cost/budget changes, expiry, concurrent token replay all reject POST | Preparation is local; returned source identity, manifest and plan hash are reviewable; paid approval control stays disabled |
| Submit/checkpoint/restart | Fake POST returns task ID; ambiguous response, timeout and submitting restart never resubmit; actual consecutive disk-fault case distinguishes memory ID from durable checkpoint | Main submit rejects frozen false permission before payload/source/image/key/HTTP/approval consumption |
| Credentials and wire | Fake-key exchange verifies fixed global origin and exact methods/paths; foreign/subframe authorization, array/object coercion, raw-return and network tripwires are exercised | Slot `minimax-video-payg` only; encrypted existing CredentialStore; renderer has status/set/clear and no raw getter; adapter installed, account access unverified, paid permission false |
| Observe and cancel | Strict task/model/type/state checks, queued cancel versus delete race, running-state honesty, bounded persisted GET/collection limits, shutdown late-GET suppression | Disabled main observer returns stored state without provider requests or key reads; local cancellation is distinct from confirmed provider cancellation/refund |
| Collect and verify | Injected DNS/stream rejects wrong hosts, redirects, mixed private DNS, rebinding, MIME, size, truncation, stream errors and abort; real local video is fully decoded | Result URL stays main-only; exact documented CDN, IPv4-only fail-closed policy, no CDN auth header; remote success alone is not generated success |
| First-frame image | Real PNG snapshot, dimension/ratio/decode and SHA256; changed approved bytes reject fixture POST | One optional verified PNG/JPEG frame; original video/audio is never a reference transmission |
| Local review and import | Real 4-second 1366×768 silent testsrc MP4 becomes a verified 2-second fit/trim review; original bytes/timeline stay unchanged; actual React host playback/handoff imports through one history transaction, Undo and save=0 | Existing local playback protocol; labels separate generated/local-render/kept-original; source/project/epoch/track/placement/open/lock checks guard application |
| Retention | 105 actual prepare/cancel cycles, restart, oldest-safe order, all-protected limit, concurrent preparation, legacy unknown protection and real persistence fault | At 100 records only provably never-dispatched cancelled/expired preparations can retire; active approvals, dispatch history, remote IDs and unknown/results stay protected |

Final local runtime-source verification at stage-4 code pin:

- Root typecheck, root build and mobile typecheck passed. Mobile screens are
  unchanged under the explicit desktop task scope; the mobile compiler still
  checks the shared contracts.
- Complete `npm test -- --maxWorkers=1`: **266 files / 1784 tests passed**.
- The latest default-parallel run at that source state had **one failure** in the
  unchanged `assetLibraryConcurrency.test.ts` same-size mutation case. Its related
  run and complete single-worker suite passed. A preceding full parallel run
  before the final shutdown regression passed 266 files / 1783 tests. Those
  observations must not be conflated with latest default-parallel success.
- The 105-cycle real-disk retention regression uses an explicit 30-second test
  bound after a parallel 5-second timeout. Runtime bounds were not relaxed.
- The assembly contact sheet was inspected:
  `/tmp/openscene-rea-generation-review/local-assembly-review_sheet.png`.
  It shows the expected six moving synthetic pattern frames across the two-second
  review. This is local testsrc media, not a provider-generated quality sample.

## Historical findings and remaining gates

| Item | Resolution / required next action |
| --- | --- |
| Task-ID durability P2 | Fixed in #584: memory retention is not overstated as durable retention after two failed writes; restart has unknown outcome, possibly no ID, and still no POST |
| Permanent JOB_LIMIT P2 | Fixed in #586 and propagated by normal merges: safe pre-submit retention, protected submitted/unknown records, rollback and regressions; re-review still required |
| Default-parallel asset mutation failure | Disclosed; unrelated source/test untouched. Latest single-worker suite is green; CI results remain a separate exact-HEAD observation |
| Stage-4 CI | Android was still in progress at the recorded code pin; fresh documentation-successor CI is required, without assuming old checks apply |
| Formal review | #584 final verdict and latest-pin #586/#588/#590 reviews remain coordinator-owned pending signals; owner continues all requested fixes |
| Live permission/account access | No real key/status lookup, submit/upload/result download/cancel, model download, account change or GPU/Jev service change occurred. Frozen paid permission remains false; no live permission is inferred from fixture success |
| Live quality and coverage | Actual account/model access, live provider wire behavior, current billing, CDN coverage and generated-media quality remain unverified. Only the exact documented CDN is allowed; unknown hosts/IPv6 fail closed |
| Session/recovery limit | Verified library assets and job checkpoints persist, but result selection is session-local. No automatic reapproval, re-POST, timeline apply or save occurs on restart. All-protected capacity still honestly returns JOB_LIMIT |
| Semantics | Existing measured analysis still reports semantic interpretation unavailable. Local renders, placeholders or fixture success do not change it into semantic or remote generation success |

See [offline core](rea-generation-offline.md), [credential/review seam](rea-generation-review.md),
[verified results](rea-generation-results.md) and
[provider boundary](rea-generation-provider-boundary.md) for implementation details.
