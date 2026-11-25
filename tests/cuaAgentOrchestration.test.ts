import { describe, expect, it } from 'vitest';
import type { CuaActionRequest } from '../src/shared/cua';
import { CuaApprovalAuthority } from '../src/main/cuaAgentOrchestration';

const request: CuaActionRequest = {
  contentRevision: 0,
  sessionId: 'session', runId: 'run', windowId: 1, frameId: 'frame', layoutRevision: 3,
  action: { kind: 'drag', from: { x: 10, y: 20 }, to: { x: 50, y: 20 }, durationMs: 100 }
};
function fixture(maxActionsPerRun = 2) {
  let now = 0;
  const authority = new CuaApprovalAuthority({ permitTtlMs: 100, maxActionsPerRun, now: () => now });
  const approve = (id = 'call', action = request) => {
    authority.propose('conversation', id, action);
    return authority.issueApproved('conversation', id, action);
  };
  return { authority, approve, advance: (ms: number) => { now += ms; } };
}

describe('main CUA approval authority', () => {
  it('can preflight repeatedly without consumption or extending the original TTL', () => {
    const { authority, approve, advance } = fixture();
    const token = approve();
    authority.check(request, token);
    authority.check(request, token);
    advance(99);
    authority.check(request, token);
    advance(1);
    expect(() => authority.check(request, token)).toThrow('CUA_APPROVAL_EXPIRED');
    expect(() => authority.consume(request, token)).toThrow('CUA_APPROVAL_EXPIRED');
    expect(() => authority.consume(request, token)).toThrow('CUA_ACTION_REPLAYED');
  });

  it('checks exact evidence without mutating a permit on failed preflight', () => {
    const { authority, approve } = fixture();
    const token = approve();
    expect(() => authority.check({ ...request, frameId: 'different' }, token)).toThrow('CUA_APPROVAL_MISMATCH');
    authority.check(request, token);
    authority.consume(request, token);
    expect(() => authority.check(request, token)).toThrow('CUA_ACTION_REPLAYED');
  });

  it('rejects cancellation between preflight and final consumption', () => {
    const { authority, approve } = fixture();
    const token = approve();
    authority.check(request, token);
    authority.revokeRun(request.runId);
    expect(() => authority.consume(request, token)).toThrow('CUA_CANCELLED');
  });

  it('fails closed if the trusted monotonic clock becomes invalid', () => {
    const { authority, approve, advance } = fixture();
    const token = approve();
    advance(Number.NaN);
    expect(() => authority.consume(request, token)).toThrow('CUA_APPROVAL_EXPIRED');
  });

  it('denial dispatches nothing and cannot later be upgraded by replay', () => {
    const { authority } = fixture();
    authority.propose('conversation', 'call', request);
    authority.deny('conversation', 'call');
    expect(() => authority.issueApproved('conversation', 'call', request)).toThrow('CUA_APPROVAL_MISMATCH');
    expect(() => authority.propose('conversation', 'call', request)).toThrow('CUA_ACTION_REPLAYED');
  });

  it('accepts exactly one consumption and rejects duplicate approval', () => {
    const { authority, approve } = fixture();
    const token = approve();
    expect(() => authority.issueApproved('conversation', 'call', request)).toThrow('CUA_APPROVAL_MISMATCH');
    authority.consume(request, token);
    expect(() => authority.consume(request, token)).toThrow('CUA_ACTION_REPLAYED');
  });

  it.each(['sessionId', 'runId', 'windowId', 'frameId', 'layoutRevision', 'contentRevision'] as const)('binds %s to the original evidence', (field) => {
    const { authority, approve } = fixture();
    const token = approve();
    const changed = { ...request, [field]: typeof request[field] === 'number' ? 99 : 'different' } as CuaActionRequest;
    expect(() => authority.consume(changed, token)).toThrow('CUA_APPROVAL_MISMATCH');
    expect(() => authority.consume(request, token)).toThrow('CUA_ACTION_REPLAYED');
  });

  it('snapshots action arguments before approval and rejects a changed drag', () => {
    const { authority } = fixture();
    const mutable = structuredClone(request);
    authority.propose('conversation', 'call', mutable);
    if (mutable.action.kind === 'drag') Object.assign(mutable.action.to, { x: 999 });
    expect(() => authority.issueApproved('conversation', 'call', mutable)).toThrow('CUA_APPROVAL_MISMATCH');
    const token = authority.issueApproved('conversation', 'call', request);
    expect(() => authority.consume(mutable, token)).toThrow('CUA_APPROVAL_MISMATCH');
  });

  it('never resets the permit clock and rejects its exact expiry boundary', () => {
    const { authority, approve, advance } = fixture();
    const token = approve();
    advance(100);
    expect(() => authority.consume(request, token)).toThrow('CUA_APPROVAL_EXPIRED');
    expect(() => authority.consume(request, token)).toThrow('CUA_ACTION_REPLAYED');
  });

  it('cancellation revokes pending and issued permits before input release', () => {
    const { authority, approve } = fixture();
    const token = approve();
    authority.revokeRun('run');
    authority.revokeRun('run');
    expect(() => authority.consume(request, token)).toThrow('CUA_CANCELLED');
    expect(() => authority.propose('conversation', 'new', request)).toThrow('CUA_CANCELLED');
  });

  it('blocks another proposal until the approved action has been consumed', () => {
    const { authority, approve } = fixture();
    const token = approve();
    expect(() => authority.propose('other', 'call', request)).toThrow('CUA_BUSY');
    authority.consume(request, token);
    authority.propose('other', 'call', request);
    expect(() => authority.consume(request, token)).toThrow('CUA_BUSY');
  });

  it('bounds consumed actions per run, across conversations and new call IDs', () => {
    const { authority, approve } = fixture(1);
    authority.consume(request, approve());
    expect(() => authority.propose('other', 'next', request)).toThrow('CUA_BUDGET_EXCEEDED');
  });

  it('locks every new run when release cleanup failed', () => {
    const { authority, approve } = fixture();
    const token = approve();
    authority.recordCleanupFailure();
    expect(() => authority.consume(request, token)).toThrow('CUA_CLEANUP_FAILED');
    expect(() => authority.propose('other', 'next', { ...request, runId: 'new-run' })).toThrow('CUA_CLEANUP_FAILED');
  });
});
