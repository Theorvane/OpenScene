import type { CuaSaveScope } from '../shared/cuaSave';

/** Main-only arbitration shared by the input and Save authority instances. */
export class CuaApprovalGate {
  private holder: { owner: object; runId: string } | null = null;

  acquire(owner: object, runId: string): boolean {
    if (this.holder) return false;
    this.holder = { owner, runId };
    return true;
  }
  release(owner: object): void { if (this.holder?.owner === owner) this.holder = null; }
  revokeRun(runId: CuaSaveScope['runId']): void { if (this.holder?.runId === runId) this.holder = null; }
}

/** Start every cleanup even if another throws synchronously, then wait for all
 * physical release/storage settlement before propagating any failure. */
export async function settleCuaCancellation(cleanups: readonly (() => Promise<unknown>)[]): Promise<void> {
  const settled = await Promise.allSettled(cleanups.map((cleanup) => Promise.resolve().then(cleanup)));
  const errors = settled.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  if (errors.length) throw new AggregateError(errors, 'CUA cancellation cleanup failed after all operations settled.');
}
