import type { AgentCuaSaveApprovalSummary } from '../shared/agentChat';
import type { CuaSaveProposal, CuaSaveResult, CuaSaveScope } from '../shared/cuaSave';
import type { CuaSaveBridge } from './cuaSaveBridge';
import { CuaApprovalError, type CuaApprovalAuthority } from './cuaAgentOrchestration';
import { CuaSaveApprovalAuthority } from './cuaSaveApprovalAuthority';

interface Entry {
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly scope: CuaSaveScope;
  readonly preparation: Promise<CuaSaveProposal>;
  proposal: CuaSaveProposal | null;
  summary: AgentCuaSaveApprovalSummary | null;
  execution: Promise<CuaSaveResult> | null;
  cancelled: boolean;
}
const scopeKey = (scope: CuaSaveScope) => JSON.stringify([scope.projectId, scope.sessionId, scope.runId,
  scope.windowId, scope.frameId, scope.layoutRevision, scope.contentRevision]);

/** Main-only Save dispatch. Scope and canonical storage checks remain separate:
 * the input runtime binds conversation/project, and the bridge verifies the
 * actual live document and disk bytes at publication. */
export class CuaAgentSaveOrchestrator {
  private readonly entries = new Map<string, Entry>();
  private readonly cancellations = new Map<string, Promise<void>>();
  private readonly lastResults = new Map<string, CuaSaveResult>();

  constructor(readonly authority: CuaSaveApprovalAuthority, private readonly options: {
    readonly bridge: Pick<CuaSaveBridge, 'prepareSaveSnapshot' | 'saveApproved' | 'cancelRun' | 'settleWrites'>;
    readonly assertScope: (conversationId: string, scope: CuaSaveScope) => void;
    readonly inputAuthority: CuaApprovalAuthority;
  }) { authority.shareInputApprovalGate(options.inputAuthority); }

  async prepareApproval(conversationId: string, toolCallId: string, scope: CuaSaveScope): Promise<AgentCuaSaveApprovalSummary> {
    this.options.assertScope(conversationId, scope);
    let entry = this.entries.get(conversationId);
    if (entry) {
      if (entry.toolCallId !== toolCallId || scopeKey(entry.scope) !== scopeKey(scope) || entry.cancelled) {
        throw new CuaApprovalError('CUA_APPROVAL_MISMATCH');
      }
      await entry.preparation;
      if (entry.summary) return structuredClone(entry.summary);
      throw new CuaApprovalError('CUA_APPROVAL_MISMATCH');
    }
    if (this.entries.size || this.cancellations.size) throw new CuaApprovalError('CUA_BUSY');
    const snapshot = structuredClone(scope);
    // Install before invoking bridge callbacks, just as the driver does for
    // cancellation. Replayed graph interrupts reuse this immutable preparation.
    const preparation = Promise.resolve().then(() => this.options.bridge.prepareSaveSnapshot(snapshot));
    entry = { conversationId, toolCallId, scope: snapshot, preparation, proposal: null, summary: null, execution: null, cancelled: false };
    this.entries.set(conversationId, entry);
    this.lastResults.delete(conversationId);
    try {
      const proposal = await preparation;
      if (entry.cancelled) throw new CuaApprovalError('CUA_CANCELLED');
      this.options.assertScope(conversationId, snapshot);
      if (scopeKey(proposal.scope) !== scopeKey(snapshot)) throw new CuaApprovalError('CUA_SCOPE_CHANGED');
      entry.proposal = structuredClone(proposal);
      entry.summary = this.authority.propose(conversationId, toolCallId, entry.proposal);
      return structuredClone(entry.summary);
    } catch (error) {
      if (this.entries.get(conversationId) === entry) this.entries.delete(conversationId);
      throw error;
    }
  }

  deny(conversationId: string, toolCallId: string): void {
    const entry = this.entries.get(conversationId);
    if (!entry || entry.toolCallId !== toolCallId) throw new CuaApprovalError('CUA_APPROVAL_MISMATCH');
    this.authority.deny(conversationId, toolCallId);
    this.entries.delete(conversationId);
  }

  executeApproved(conversationId: string, toolCallId: string, scope: CuaSaveScope): Promise<CuaSaveResult> {
    const entry = this.entries.get(conversationId);
    if (!entry || entry.toolCallId !== toolCallId || scopeKey(entry.scope) !== scopeKey(scope) || !entry.proposal) {
      return Promise.reject(new CuaApprovalError('CUA_APPROVAL_MISMATCH'));
    }
    if (entry.execution) return entry.execution;
    try {
      this.options.assertScope(conversationId, entry.scope);
      const permit = this.authority.issueApproved(conversationId, toolCallId, entry.proposal);
      const execution = Promise.resolve().then(() => this.options.bridge.saveApproved(entry.proposal!.proposalId, permit))
        .then((result) => {
          // The trusted bridge's terminal receipt survives late cancel and UI
          // acknowledgement failure. It must never be replaced with a retry.
          if (result.runId !== entry.scope.runId || result.projectId !== entry.scope.projectId
            || result.snapshotId !== entry.proposal!.snapshotId || result.timelineDigest !== entry.proposal!.timelineDigest
            || result.expectedContentRevision !== entry.scope.contentRevision) throw new CuaApprovalError('CUA_SCOPE_CHANGED');
          this.lastResults.set(conversationId, structuredClone(result));
          return result;
        }).finally(() => {
          this.authority.discardProposal(entry.proposal!.proposalId);
          if (this.entries.get(conversationId) === entry) this.entries.delete(conversationId);
        });
      entry.execution = execution;
      return execution;
    } catch (error) {
      this.authority.discardProposal(entry.proposal.proposalId);
      if (this.entries.get(conversationId) === entry) this.entries.delete(conversationId);
      return Promise.reject(error);
    }
  }

  /** Synchronous revocation/request only; cancellation still awaits the actual
   * preparation/execution promises before a session can declare settlement. */
  abortRun(runId: string): void {
    this.authority.revokeRun(runId);
    for (const entry of this.entries.values()) {
      if (entry.scope.runId !== runId || entry.cancelled) continue;
      entry.cancelled = true;
      this.options.bridge.cancelRun(runId);
    }
  }

  cancelConversation(conversationId: string): Promise<void> {
    const existing = this.cancellations.get(conversationId);
    if (existing) return existing;
    const entry = this.entries.get(conversationId);
    if (!entry) return Promise.resolve();
    this.abortRun(entry.scope.runId);
    const settlement = Promise.allSettled([entry.preparation, ...(entry.execution ? [entry.execution] : [])])
      .then(() => undefined).finally(() => {
        if (this.entries.get(conversationId) === entry) this.entries.delete(conversationId);
        this.cancellations.delete(conversationId);
      });
    this.cancellations.set(conversationId, settlement);
    return settlement;
  }

  getLastResult(conversationId: string): CuaSaveResult | null {
    const result = this.lastResults.get(conversationId);
    return result ? structuredClone(result) : null;
  }
}
