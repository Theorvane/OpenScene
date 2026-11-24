import type { TimelineDocument } from './timelineTypes';

/** A Save is a separate explicitly approved capability, never a pointer action. */
export interface CuaSaveScope {
  readonly projectId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly windowId: number;
  readonly frameId: string;
  readonly layoutRevision: number;
  readonly contentRevision: number;
}
export interface CuaSaveSnapshotRequest { readonly requestToken: string; readonly scope: CuaSaveScope }
export interface CuaSaveSnapshotReport {
  readonly requestToken: string;
  readonly runId: string;
  readonly projectId: string;
  readonly contentRevision: number;
  readonly dirty: boolean;
  readonly timeline: TimelineDocument;
}
/** Main computes the digest and caches immutable bytes before approval. */
export interface CuaSaveProposal {
  readonly proposalId: string;
  readonly snapshotId: string;
  readonly timelineDigest: string;
  readonly scope: CuaSaveScope;
  readonly dirty: boolean;
  readonly clipCount: number;
  readonly titleCount: number;
  readonly summary: string;
}
export interface CuaSaveReadyRequest { readonly saveToken: string; readonly proposal: CuaSaveProposal }
export interface CuaSaveReadyAck {
  readonly saveToken: string;
  readonly runId: string;
  readonly projectId: string;
  readonly contentRevision: number;
  readonly snapshotId: string;
  readonly timelineDigest: string;
  readonly ready: boolean;
  readonly errorCode?: string;
}
export type CuaSaveStatus = 'not-written' | 'persisted' | 'persisted-after-cancel' | 'already-clean' | 'write-outcome-unknown';
/** A terminal outcome always releases the FE freeze, even when no file was written. */
export interface CuaSaveResult {
  readonly saveToken: string;
  readonly runId: string;
  readonly projectId: string;
  readonly snapshotId: string;
  readonly timelineDigest: string;
  readonly expectedContentRevision: number;
  readonly persistedUpdatedAt: string | null;
  readonly status: CuaSaveStatus;
  readonly diskMatches: boolean | null;
  readonly uiApplied: boolean;
  readonly errorCode: string | null;
}
export interface CuaSaveCommitAck {
  readonly saveToken: string;
  readonly runId: string;
  readonly projectId: string;
  readonly contentRevision: number;
  readonly uiApplied: boolean;
}
