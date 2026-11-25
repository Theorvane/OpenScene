import { describe, expect, it } from 'vitest';
import { CuaSaveApprovalAuthority } from '../src/main/cuaSaveApprovalAuthority';
import { CuaApprovalAuthority } from '../src/main/cuaAgentOrchestration';
import type { CuaSaveProposal } from '../src/shared/cuaSave';
import type { CuaActionRequest } from '../src/shared/cua';
import { CUA_SAVE_TOOL_SCHEMA } from '../src/main/agentChatTools';

const proposal: CuaSaveProposal = {
  proposalId: 'proposal', snapshotId: 'snapshot', timelineDigest: 'a'.repeat(64),
  scope: { projectId: 'project', sessionId: 'session', runId: 'run', windowId: 1,
    frameId: 'frame', layoutRevision: 1, contentRevision: 2 },
  dirty: true, clipCount: 3, titleCount: 1, summary: 'Save the explicitly approved live editor snapshot'
};
function fixture() {
  let now = 0;
  const authority = new CuaSaveApprovalAuthority({ permitTtlMs: 100, proposalTtlMs: 200, maxSavesPerRun: 2, now: () => now });
  const approve = () => { authority.propose('conversation', 'call', proposal); return authority.issueApproved('conversation', 'call', proposal); };
  return { authority, approve, advance: (ms: number) => { now += ms; } };
}

describe('separate main Save approval authority', () => {
  it('projects the exact cached proposal for human approval and consumes only once', () => {
    const { authority } = fixture();
    const summary = authority.propose('conversation', 'call', proposal);
    expect(summary).toMatchObject({ actionKind: 'save', snapshotId: proposal.snapshotId,
      timelineDigest: proposal.timelineDigest, projectId: 'project', contentRevision: 2, dirty: true });
    expect(authority.getPendingApproval()).toEqual({ ...proposal.scope, conversationId: 'conversation', toolCallId: 'call' });
    const token = authority.issueApproved('conversation', 'call', proposal);
    expect(authority.getPendingApproval()).toBeNull();
    authority.check(proposal, token);
    authority.check(proposal, token);
    authority.consume(proposal, token);
    expect(() => authority.consume(proposal, token)).toThrow('CUA_ACTION_REPLAYED');
  });

  it.each(['projectId', 'sessionId', 'runId', 'windowId', 'frameId', 'layoutRevision', 'contentRevision'] as const)('binds Save %s', (field) => {
    const { authority, approve } = fixture();
    const token = approve();
    const changed = { ...proposal, scope: { ...proposal.scope,
      [field]: typeof proposal.scope[field] === 'number' ? 99 : 'other' } } as CuaSaveProposal;
    expect(() => authority.consume(changed, token)).toThrow('CUA_APPROVAL_MISMATCH');
    expect(() => authority.consume(proposal, token)).toThrow('CUA_ACTION_REPLAYED');
  });

  it.each(['proposalId', 'snapshotId', 'timelineDigest', 'summary'] as const)('binds the original %s without trusting a replacement label or identity', (field) => {
    const { authority, approve } = fixture();
    expect(() => authority.check({ ...proposal, [field]: 'different' }, approve())).toThrow('CUA_APPROVAL_MISMATCH');
  });

  it('does not mutate a cached proposal when its caller changes an object after preparation', () => {
    const { authority } = fixture();
    const mutable = structuredClone(proposal);
    authority.propose('conversation', 'call', mutable);
    Object.assign(mutable.scope, { contentRevision: 99 });
    expect(() => authority.issueApproved('conversation', 'call', mutable)).toThrow('CUA_APPROVAL_MISMATCH');
    const token = authority.issueApproved('conversation', 'call', proposal);
    authority.consume(proposal, token);
  });

  it('denial and cancellation produce no consumable Save authority', () => {
    const { authority } = fixture();
    authority.propose('conversation', 'call', proposal);
    authority.deny('conversation', 'call');
    expect(() => authority.issueApproved('conversation', 'call', proposal)).toThrow('CUA_APPROVAL_MISMATCH');
    expect(() => authority.propose('conversation', 'call', proposal)).toThrow('CUA_ACTION_REPLAYED');
    authority.propose('conversation', 'new', proposal);
    const token = authority.issueApproved('conversation', 'new', proposal);
    authority.revokeRun('run');
    expect(() => authority.consume(proposal, token)).toThrow('CUA_CANCELLED');
  });

  it('does not reset the issue clock during ready acknowledgement or repeated checks', () => {
    const { authority, approve, advance } = fixture();
    const token = approve();
    advance(99);
    authority.check(proposal, token);
    advance(1);
    expect(() => authority.consume(proposal, token)).toThrow('CUA_APPROVAL_EXPIRED');
  });

  it('does not renew an old snapshot clock when approval is finally issued', () => {
    const { authority, advance } = fixture();
    authority.propose('conversation', 'call', proposal);
    advance(199);
    const token = authority.issueApproved('conversation', 'call', proposal);
    advance(1);
    expect(() => authority.check(proposal, token)).toThrow('CUA_APPROVAL_EXPIRED');
  });

  it('keeps pointer and Save permit pools non-interchangeable', () => {
    const { authority, approve } = fixture();
    const pointer = new CuaApprovalAuthority({ permitTtlMs: 100, maxActionsPerRun: 1, now: () => 0 });
    const request: CuaActionRequest = { sessionId: 'session', runId: 'run', windowId: 1,
      frameId: 'frame', layoutRevision: 1, contentRevision: 2, action: { kind: 'click', point: { x: 1, y: 1 } } };
    pointer.propose('conversation', 'pointer', request);
    const pointerToken = pointer.issueApproved('conversation', 'pointer', request);
    const saveToken = approve();
    expect(() => authority.check(proposal, pointerToken)).toThrow('CUA_ACTION_REPLAYED');
    expect(() => pointer.check(request, saveToken)).toThrow('CUA_ACTION_REPLAYED');
    pointer.consume(request, pointerToken);
    authority.consume(proposal, saveToken);
  });

  it('rejects model-provided permits, snapshot bytes and identity strings in the scope tool schema', () => {
    expect(CUA_SAVE_TOOL_SCHEMA.safeParse(proposal.scope).success).toBe(true);
    for (const key of ['permit', 'timeline', 'timelineDigest', 'snapshotId', 'proposalId']) {
      expect(CUA_SAVE_TOOL_SCHEMA.safeParse({ ...proposal.scope, [key]: 'injected' }).success).toBe(false);
    }
  });
});
