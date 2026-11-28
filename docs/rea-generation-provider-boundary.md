# REA fixed provider boundary (dependency 4)

The [stage integration status](rea-generation-integration-status.md) records exact
source pins, CI snapshots, resolved findings and remaining review/live gates.

Issue #589 is stacked on #587 / PR #588. This completes the offline implementation
chain's provider/submit/observation wiring. Earlier dependency documents describe
their own PR scope; this document supersedes their unavailable-provider/no-submit
statements. It does **not** authorize or claim a live provider execution.

The product now installs the concrete MiniMax H3 adapter and fixed-host global
PAYG transport, with lazy main-only credential access to `minimax-video-payg`.
`adapterImplemented` is true for this installed adapter. Documentation checked,
offline fixture implementation, configured credential, unverified account access
and paid execution permission remain distinct fields. `paidExecutionAllowed`
remains the frozen false policy; there is no preference or IPC to enable it.

The narrow submit IPC checks the owning live main frame. The submission service
rejects disabled permission before inspecting a payload, resolving source/image,
reading keys, consuming approval or making HTTP requests. The adapter and
transport independently enforce the same gate. The main observer returns only
the stored receipt while disabled; it does not poll, download or read a key.
No test fixture adapter is installed into the application. Test permission is
explicit to injected fixtures and cannot enable the production runner.

If execution is separately enabled by a future reviewed change, the existing
path revalidates the exact reviewed plan, one-use token, current source identity
and first-frame bytes before the atomic submitting checkpoint and one POST.
Source identity is computed in main from bounded full-file SHA256, file identity
and measured duration. Source ranges must fit the real local video (at most ten
minutes); source/epoch/prompt/image/budget changes reject submission. The source
identity is part of planHash and is not sent to the provider. Old plans without
this identity cannot pass the submission boundary. Provider prompts are limited
to the official ContentItem maximum of 7000 characters (UTF-16 length is used as
a conservative bound).

Provider HTTP has only POST `/v2/video_generation`, GET
`/v2/query/video_generation/{task_id}` and DELETE
`/v2/video_generation/{task_id}`. The origin is always `https://api.minimax.io`;
paths, method/body combinations and request size are closed. There is no redirect
or region/model fallback. A lazy video-slot key is used only as the Bearer header
to this origin. Responses are JSON-only, bounded during reading to 256 KiB, and
requests have a ten-second total deadline. Provider error text, keys and paths
are reduced to fixed errors. CDN download remains unauthenticated and separately
constrained by the dependency-3 policy.

The concrete main runner joins strict task observation to verification and local
asset registration; main service get/cancel/shutdown are wired to it. Native
submit returns a queued task receipt, never a generated asset. Provider result
retrieval has at most three persisted collection attempts inside the existing
120-GET/30-minute overall budget, including across restart. A confirmed cancel
and record deletion remain different remote actions. Local cancellation aborts
collection/assembly and retires UI handoffs, without promising billing stop.

The safe-retention review fix from PR #586 is included by normal merge: only
provably never-dispatched cancelled/expired preparations can be evicted at the
100-record limit. Dispatch markers, active approvals, remote IDs, unknown states
and verification/result records remain protected. No branch was force-pushed.
Job writes flush the file before atomic rename; POSIX additionally flushes the
directory entry. Node's Windows directory-fsync limitation is explicit rather
than making every Windows preparation fail. Power-loss guarantees remain bounded
by the OS/filesystem, and an ambiguous recovered checkpoint never authorizes POST.

## Verification and limits

All provider exchange tests inject fake-key HTTP functions and a failing HTTPS
tripwire. Disabled submit/adapter/transport/observation prove key reads, external
HTTP and approval consumption remain zero. Source mutation and invalid source
ranges are tested against a real tiny local FFmpeg fixture; image/source/prompt
changes reject POST. The preceding dependency's real local video/PNG, stream,
provenance, assembly, playback and history/Undo checks remain applicable.

Fresh final validation: root typecheck; `npm test -- --maxWorkers=1` (266 files,
1784 tests); root build; mobile typecheck all pass. The default parallel suite at
this final source state has one intermittent failure in the unchanged
`assetLibraryConcurrency.test.ts` same-size mutation case (the import resolved
when the test expected a concurrent mutation rejection). Its separate related
run and the complete single-worker suite pass. An earlier parallel run before
the final shutdown regression also passed 266 files / 1783 tests. These are
different observations, not a claim that the latest default parallel run passed.
The new 105-cycle retention stress has an explicit 30-second disk-I/O test bound;
implementation timeouts/limits were not relaxed. CI results must be reported
separately for the exact pushed HEAD.

No real credential or status lookup, external provider submission/upload/result
download, live cancellation, model download, account configuration or GPU/Jev
service change occurred. Account access, live wire behavior, CDN coverage and
actual provider billing remain unverified. The UI deliberately leaves its paid
approval control disabled. This is an offline-tested implementation ready for
independent review, **not** a completed live-generation run or permission to spend.
Independent same-HEAD CI and code/spec review remain required for every draft;
the implementation owner must not ready or merge them.
