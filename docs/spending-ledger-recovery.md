# Desktop spending-record recovery

The desktop stores its estimated generation charges and optional monthly ceiling
in `generation-spend.json` under Electron's `userData` directory. This is not a
provider invoice. The mobile app has separate Expo filesystem persistence and is
not changed by this desktop fix.

Only a missing desktop file starts with an empty record. An unreadable file,
invalid JSON, or invalid ledger/entry blocks API generation and ledger mutations
instead of silently removing the ceiling or discarding charges. The error is
reported through the existing generation/settings error path. Existing entries
without a `state` still count as charged; non-positive caps retain their older
meaning of no ceiling. Entry dates use the UTC ISO format emitted by the app
(for example `2026-11-18T07:00:00.000Z`), and recorded amounts must be non-negative
finite numbers.

If generation is blocked:

1. Close the app before repairing files. Keep a separate copy of the original
   `generation-spend.json`; do not delete or reset it to bypass the error.
2. For read/permission errors, restore access to that file and its directory.
   For corrupt data, restore a known-good backup or carefully repair the JSON,
   preserving the ceiling and all known charges/reservations. If history cannot
   be reconstructed, stop API generation and reconcile known usage before
   deciding on a replacement record. A reset is not automatic recovery.
3. Reopen the app and check the displayed month-to-date amount and ceiling before
   generating again. If recovery is incomplete, leave API generation blocked.

Writes now use an exclusive, owner-only sibling temporary file, sync and close
it, then rename it over the committed record. In-process operations are queued.
An ordinary failed write/sync/close/rename leaves the previous committed record
intact; failed temporary writes are cleaned up. After a process crash there may
be an orphan `generation-spend.json.<uuid>.tmp`: preserve it for diagnosis, not
as an automatically trusted replacement. The app reads only the committed file.
This does not provide multi-process locking or parent-directory fsync/power-loss
durability, reconcile provider billing, or fix the mobile storage adapter.
