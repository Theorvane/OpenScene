import { describe, expect, it } from 'vitest';
import { CuaApprovalAuthority } from '../src/main/cuaAgentOrchestration';
import { CuaSaveApprovalAuthority } from '../src/main/cuaSaveApprovalAuthority';
import { settleCuaCancellation } from '../src/main/cuaApprovalGate';
import { buildAgentChatGraph } from '../src/main/agentChatGraph';
import { AgentChatSessionManager } from '../src/main/agentChatSession';
import { AIMessage } from '@langchain/core/messages';
import type { CuaActionRequest } from '../src/shared/cua';
import type { CuaSaveProposal } from '../src/shared/cuaSave';

const input: CuaActionRequest = { sessionId: 's', runId: 'r', windowId: 1, frameId: 'f', layoutRevision: 1, contentRevision: 2,
  action: { kind: 'click', point: { x: 10, y: 10 } } };
const proposal: CuaSaveProposal = { scope: { ...input, projectId: 'p' }, proposalId: 'proposal', snapshotId: 'snapshot',
  timelineDigest: 'a'.repeat(64), dirty: true, clipCount: 1, titleCount: 0, summary: 'Save exact snapshot' };
function pair() {
  const pointer = new CuaApprovalAuthority({ permitTtlMs: 100, maxActionsPerRun: 3, now: () => 0 });
  const save = new CuaSaveApprovalAuthority({ permitTtlMs: 100, proposalTtlMs: 200, maxSavesPerRun: 3, now: () => 0 });
  save.shareInputApprovalGate(pointer);
  return { pointer, save };
}
describe('shared main approval arbitration', () => {
  it('reserves the shared gate during snapshot preparation without pretending approval exists', () => {
    const { pointer, save } = pair();
    save.reservePreparation('a', 'save', proposal.scope);
    expect(save.getPendingApproval()).toBeNull();
    save.discardProposal('unrelated-old-proposal');
    expect(() => save.consume(proposal, 'wrong-token')).toThrow('CUA_BUSY');
    expect(() => pointer.propose('b', 'click', input)).toThrow('CUA_BUSY');
    save.releasePreparation('wrong-conversation', 'save');
    expect(() => pointer.propose('b', 'click', input)).toThrow('CUA_BUSY');
    save.propose('a', 'save', proposal);
    expect(save.getPendingApproval()?.conversationId).toBe('a');
    expect(() => pointer.propose('b', 'click', input)).toThrow('CUA_BUSY');
    save.deny('a', 'save');
    pointer.propose('b', 'click', input);
  });

  it('releases failed or cancelled preparation without leaving a hidden pending authority', () => {
    const { pointer, save } = pair();
    save.reservePreparation('a', 'failed', proposal.scope);
    save.releasePreparation('a', 'failed');
    pointer.propose('b', 'click', input);
    pointer.deny('b', 'click');
    save.reservePreparation('a', 'cancelled', proposal.scope);
    save.revokeRun('r');
    expect(save.getPendingApproval()).toBeNull();
    expect(() => save.propose('a', 'cancelled', proposal)).toThrow('CUA_CANCELLED');
    pointer.propose('b', 'new', { ...input, runId: 'new-run' });
  });

  it('never permits simultaneous input and Save pending approval, across conversations', () => {
    const { pointer, save } = pair();
    pointer.propose('a', 'click', input);
    expect(() => save.propose('b', 'save', proposal)).toThrow('CUA_BUSY');
    expect(save.getPendingApproval()).toBeNull();
    pointer.deny('a', 'click');
    save.propose('b', 'save', proposal);
    expect(() => pointer.propose('a', 'next', input)).toThrow('CUA_BUSY');
    expect(pointer.getPendingApproval()).toBeNull();
  });

  it('retains arbitration after issuing a permit and rejects re-entry until consumption', () => {
    const { pointer, save } = pair();
    pointer.propose('a', 'click', input);
    const token = pointer.issueApproved('a', 'click', input);
    expect(() => save.propose('b', 'save', proposal)).toThrow('CUA_BUSY');
    expect(() => pointer.consume(input, 'wrong-token')).toThrow('CUA_ACTION_REPLAYED');
    expect(() => save.propose('b', 'save', proposal)).toThrow('CUA_BUSY');
    pointer.consume(input, token);
    save.propose('b', 'save', proposal);
    const permit = save.issueApproved('b', 'save', proposal);
    expect(() => pointer.propose('a', 'next', input)).toThrow('CUA_BUSY');
    save.consume(proposal, permit);
    pointer.propose('a', 'next', input);
  });

  it.each(['pointer', 'save'] as const)('awaits the other cleanup when %s fails immediately', async (failed) => {
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    let ended = false, delayedCompleted = false;
    const failure = () => { throw new Error(`${failed} failed`); };
    const delay = async () => { await delayed; delayedCompleted = true; };
    const result = settleCuaCancellation(failed === 'pointer' ? [failure, delay] : [delay, failure]);
    const rejected = expect(result).rejects.toThrow('all operations settled');
    void result.catch(() => { ended = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(ended).toBe(false);
    release();
    await rejected;
    expect(delayedCompleted).toBe(true);
  });

  it.each(['pointer', 'save'] as const)('does not return Session cancellation early after %s failure', async (failed) => {
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    let delayedCompleted = false;
    const session = new AgentChatSessionManager(buildAgentChatGraph({ tools: [], mutatingToolNames: new Set(),
      createModel: () => ({ invoke: async () => new AIMessage('Ready') }) }), { cancelCua: () => settleCuaCancellation([
        ...failed === 'pointer' ? [async () => { throw new Error('pointer release failed'); }, async () => { await delayed; delayedCompleted = true; }]
          : [async () => { await delayed; delayedCompleted = true; }, async () => { throw new Error('Save settlement failed'); }]
      ]) });
    const cancelled = session.cancelConversation({ conversationId: 'a' });
    let ended = false;
    void cancelled.then(() => { ended = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(ended).toBe(false);
    release();
    const result = await cancelled;
    expect(delayedCompleted).toBe(true);
    expect(result.errorCode).toBe('CUA_CLEANUP_FAILED');
  });
});
