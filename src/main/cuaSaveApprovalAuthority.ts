import { createHash, randomUUID } from 'node:crypto';
import type { CuaSaveProposal } from '../shared/cuaSave';
import type { AgentCuaSaveApprovalSummary } from '../shared/agentChat';
import { CuaApprovalError } from './cuaAgentOrchestration';

function proposalDigest(proposal: CuaSaveProposal): string {
  const scope = proposal.scope;
  return createHash('sha256').update(JSON.stringify([
    'openscene-explicit-save-v1', proposal.proposalId, proposal.snapshotId, proposal.timelineDigest,
    scope.projectId, scope.sessionId, scope.runId, scope.windowId, scope.frameId,
    scope.layoutRevision, scope.contentRevision, proposal.dirty, proposal.clipCount,
    proposal.titleCount, proposal.summary
  ])).digest('hex');
}

interface Approval {
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly proposal: CuaSaveProposal;
  readonly digest: string;
  readonly proposedAt: number;
}
interface SavePermit extends Approval { readonly issuedAt: number }

/** Main-only, separate from pointer permits. The backend owns canonical live
 * snapshot/disk-baseline checks and invokes consume at the final publication
 * boundary. No renderer string or acknowledgement can issue these permits. */
export class CuaSaveApprovalAuthority {
  private pending: Approval | null = null;
  private readonly permits = new Map<string, SavePermit>();
  private readonly seenCalls = new Set<string>();
  private readonly revokedRuns = new Set<string>();
  private readonly savesByRun = new Map<string, number>();

  constructor(private readonly options: {
    readonly permitTtlMs: number;
    readonly proposalTtlMs: number;
    readonly maxSavesPerRun: number;
    readonly now: () => number;
  }) {
    if (!Number.isFinite(options.permitTtlMs) || options.permitTtlMs <= 0 || options.permitTtlMs > 30000
      || !Number.isFinite(options.proposalTtlMs) || options.proposalTtlMs <= 0 || options.proposalTtlMs > 120000
      || !Number.isSafeInteger(options.maxSavesPerRun) || options.maxSavesPerRun < 1 || options.maxSavesPerRun > 100) {
      throw new Error('Invalid trusted Save authority limits');
    }
  }

  propose(conversationId: string, toolCallId: string, proposal: CuaSaveProposal): AgentCuaSaveApprovalSummary {
    this.assertRun(proposal.scope.runId);
    if (this.pending || this.permits.size) throw new CuaApprovalError('CUA_BUSY');
    const call = JSON.stringify([conversationId, toolCallId]);
    if (this.seenCalls.has(call)) throw new CuaApprovalError('CUA_ACTION_REPLAYED');
    if ((this.savesByRun.get(proposal.scope.runId) ?? 0) >= this.options.maxSavesPerRun) throw new CuaApprovalError('CUA_BUDGET_EXCEEDED');
    const snapshot = structuredClone(proposal);
    this.seenCalls.add(call);
    this.pending = { conversationId, toolCallId, proposal: snapshot, digest: proposalDigest(snapshot), proposedAt: this.options.now() };
    return { actionKind: 'save', actionLabel: snapshot.summary, frameId: snapshot.scope.frameId,
      scopeRevision: snapshot.scope.layoutRevision, contentRevision: snapshot.scope.contentRevision,
      projectId: snapshot.scope.projectId, proposalId: snapshot.proposalId, snapshotId: snapshot.snapshotId,
      timelineDigest: snapshot.timelineDigest, dirty: snapshot.dirty, clipCount: snapshot.clipCount, titleCount: snapshot.titleCount };
  }

  issueApproved(conversationId: string, toolCallId: string, proposal: CuaSaveProposal): unknown {
    this.assertRun(proposal.scope.runId);
    const pending = this.pending;
    if (!pending || pending.conversationId !== conversationId || pending.toolCallId !== toolCallId
      || pending.digest !== proposalDigest(proposal)) throw new CuaApprovalError('CUA_APPROVAL_MISMATCH');
    this.assertAge(pending.proposedAt, this.options.proposalTtlMs);
    const token = randomUUID();
    this.permits.set(token, { ...pending, issuedAt: this.options.now() });
    this.pending = null;
    return token;
  }

  check(proposal: CuaSaveProposal, token: unknown): void {
    this.assertRun(proposal.scope.runId);
    if (this.pending) throw new CuaApprovalError('CUA_BUSY');
    const permit = typeof token === 'string' ? this.permits.get(token) : undefined;
    if (!permit) throw new CuaApprovalError('CUA_ACTION_REPLAYED');
    if (permit.digest !== proposalDigest(proposal)) throw new CuaApprovalError('CUA_APPROVAL_MISMATCH');
    this.assertAge(permit.proposedAt, this.options.proposalTtlMs);
    this.assertAge(permit.issuedAt, this.options.permitTtlMs);
    if ((this.savesByRun.get(proposal.scope.runId) ?? 0) >= this.options.maxSavesPerRun) throw new CuaApprovalError('CUA_BUDGET_EXCEEDED');
  }

  consume(proposal: CuaSaveProposal, token: unknown): void {
    try { this.check(proposal, token); }
    finally { if (typeof token === 'string') this.permits.delete(token); }
    this.savesByRun.set(proposal.scope.runId, (this.savesByRun.get(proposal.scope.runId) ?? 0) + 1);
  }

  deny(conversationId: string, toolCallId: string): void {
    if (this.pending?.conversationId !== conversationId || this.pending.toolCallId !== toolCallId) {
      throw new CuaApprovalError('CUA_APPROVAL_MISMATCH');
    }
    this.pending = null;
  }

  revokeRun(runId: string): void {
    this.revokedRuns.add(runId);
    if (this.pending?.proposal.scope.runId === runId) this.pending = null;
    for (const [token, permit] of this.permits) if (permit.proposal.scope.runId === runId) this.permits.delete(token);
  }

  /** Terminal non-publication/clean outcomes cannot leave an issued grant live. */
  discardProposal(proposalId: string): void {
    if (this.pending?.proposal.proposalId === proposalId) this.pending = null;
    for (const [token, permit] of this.permits) if (permit.proposal.proposalId === proposalId) this.permits.delete(token);
  }

  getPendingApproval(): Readonly<CuaSaveProposal['scope'] & { conversationId: string; toolCallId: string }> | null {
    return this.pending ? Object.freeze({ ...this.pending.proposal.scope,
      conversationId: this.pending.conversationId, toolCallId: this.pending.toolCallId }) : null;
  }

  private assertRun(runId: string): void {
    if (this.revokedRuns.has(runId)) throw new CuaApprovalError('CUA_CANCELLED');
  }

  private assertAge(start: number, ttl: number): void {
    const age = this.options.now() - start;
    if (!Number.isFinite(age) || age < 0 || age >= ttl) throw new CuaApprovalError('CUA_APPROVAL_EXPIRED');
  }
}
