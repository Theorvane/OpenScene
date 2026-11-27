# REA generation review dependency

Stacked on PR #584 / issue #583. This dependency's issue is #585. Its desktop
scope is the dedicated credential boundary and a mounted preparation-only REA
subpanel. Mobile UI is intentionally unchanged per the desktop task scope;
mobile typecheck still verifies the shared contracts.

`minimax-video-payg` is fixed to global PAYG video. The renderer can request
status, set or clear only that slot through dedicated channels. Authorization
checks the live owning BrowserWindow's webContents and exact main frame before
reading payloads or invoking the service. Input shape is strict. Credential
reads remain lazy in main; no raw-getter IPC exists. The existing encrypted
CredentialStore and safeStorage policy are reused. The generic setter rejects
the reserved slot before store access, including array/object coercion attempts;
the generic status response omits its entry. No existing slot is migrated or
used as a fallback. Errors from the dedicated boundary are fixed public text.

The product installs a disabled execution dependency, not a test transport.
There is no submit IPC and every injected production execution method throws
`PAID_EXECUTION_DISABLED`. Capability fields distinguish documentation date,
offline adapter implementation, production adapter availability (false),
configured credential, verified account access (false), and paid permission
(false). Storing a key does not change execution permission. Mounting the panel
does not automatically query any credential or account status.

The panel retains originals, prepares one text-only manual shot with the exact
prompt/estimate/budget/manifest, displays the immutable returned plan and hash,
and leaves generation approval disabled. It is mounted after the existing
analysis workspace so that existing range-review behavior remains unchanged.
Source epoch/project changes retire pending results and discard late preparation
receipts. Original range imports still use the existing host's history boundary.
There is no generated preview, image reference input, local assembly or generated
timeline import in this dependency; these remain next-stage work.

Tests use fake keys and injected services only. No real credential/status was
queried, no external paid request/upload/download was executed, and no account
access was verified. React tests mount the actual host and subpanel and test a
project switch during pending preparation, with submit and save both zero.

The store remains bounded to 100 records. At capacity, preparation can evict only
the oldest record proven never dispatched: no task ID, no dispatch marker and no
remote action, with either pre-submit cancellation or an expired unconsumed
approval. A dispatch marker is persisted before POST. Active or valid approvals,
submitting/submitted tasks, unknown outcomes and remote IDs/results are never
evicted. Legacy ambiguous states stay protected even without the marker. Evicted
IDs are never reused, and their tokens cannot resolve a job. If all records are
protected, `JOB_LIMIT` honestly refuses new preparation. Failed replacement rolls
back the in-memory candidate. There is no clear/reset, source deletion, automatic
re-POST or renewal of an approval.
