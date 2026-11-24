import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { CuaAgentSaveOrchestrator } from '../src/main/cuaAgentSaveOrchestration';
import { CuaSaveApprovalAuthority } from '../src/main/cuaSaveApprovalAuthority';
import type { CuaSaveProposal, CuaSaveResult, CuaSaveScope } from '../src/shared/cuaSave';
import { createCuaSaveAgentChatTools } from '../src/main/agentChatTools';
import { buildAgentChatGraph } from '../src/main/agentChatGraph';
import { AgentChatSessionManager } from '../src/main/agentChatSession';

const scope: CuaSaveScope = { projectId: 'project', sessionId: 'session', runId: 'run', windowId: 1,
  frameId: 'frame', layoutRevision: 1, contentRevision: 2 };
const resultFor = (proposal: CuaSaveProposal): CuaSaveResult => ({ saveToken: 'save-token', runId: 'run', projectId: 'project',
  snapshotId: proposal.snapshotId, timelineDigest: proposal.timelineDigest, expectedContentRevision: 2,
  persistedUpdatedAt: '2026-11-24T00:00:00.000Z', status: 'persisted', diskMatches: true, uiApplied: true, errorCode: null });
function fixture() {
  let preparations = 0, publications = 0, cancellations = 0;
  let waitForPublication: Promise<void> = Promise.resolve();
  let terminal: Partial<CuaSaveResult> = {};
  let admitBeforeWait = false;
  const proposals = new Map<string, CuaSaveProposal>();
  const authority = new CuaSaveApprovalAuthority({ permitTtlMs: 1000, proposalTtlMs: 2000, maxSavesPerRun: 3, now: () => 0 });
  const bridge = {
    prepareSaveSnapshot: async (value: CuaSaveScope) => {
      const proposal = { proposalId: `proposal-${++preparations}`, snapshotId: `snapshot-${preparations}`, timelineDigest: 'a'.repeat(64),
        scope: structuredClone(value), dirty: true, clipCount: 1, titleCount: 0, summary: 'Save this exact snapshot' };
      proposals.set(proposal.proposalId, proposal);
      return structuredClone(proposal);
    },
    saveApproved: async (id: string, token: unknown) => {
      const proposal = proposals.get(id)!;
      authority.check(proposal, token);
      if (admitBeforeWait) { authority.consume(proposal, token); publications++; }
      await waitForPublication;
      if (!admitBeforeWait && terminal.status !== 'not-written') { authority.consume(proposal, token); publications++; }
      return { ...resultFor(proposal), ...terminal };
    },
    cancelRun: () => { cancellations++; },
    settleWrites: async () => { await waitForPublication; }
  };
  const orchestrator = new CuaAgentSaveOrchestrator(authority, { bridge, assertScope: (conversationId, value) => {
    if (conversationId !== 'a' || JSON.stringify(value) !== JSON.stringify(scope)) throw new Error('CUA_SCOPE_CHANGED');
  } });
  return { orchestrator, authority, publications: () => publications, preparations: () => preparations,
    cancellations: () => cancellations, waitForPublication: (promise: Promise<void>) => { waitForPublication = promise; },
    admitBeforeWait: () => { admitBeforeWait = true; },
    terminal: (value: Partial<CuaSaveResult>) => { terminal = value; } };
}

describe('approved Save dispatch orchestration', () => {
  it('replays approval preparation without replacing the pinned snapshot', async () => {
    const f = fixture();
    const summary = await f.orchestrator.prepareApproval('a', 'call', scope);
    expect(await f.orchestrator.prepareApproval('a', 'call', scope)).toEqual(summary);
    expect(f.preparations()).toBe(1);
    expect(f.publications()).toBe(0);
    const result = await f.orchestrator.executeApproved('a', 'call', scope);
    expect(result.status).toBe('persisted');
    expect(f.publications()).toBe(1);
  });

  it('denial and direct tool invocation produce no publication', async () => {
    const f = fixture();
    await f.orchestrator.prepareApproval('a', 'call', scope);
    f.orchestrator.deny('a', 'call');
    await expect(f.orchestrator.executeApproved('a', 'call', scope)).rejects.toThrow('CUA_APPROVAL_MISMATCH');
    await expect(createCuaSaveAgentChatTools()[0]!.invoke(scope)).rejects.toThrow('CUA_APPROVAL_MISMATCH');
    expect(f.publications()).toBe(0);
  });

  it('rejects another conversation before even requesting a live snapshot', async () => {
    const f = fixture();
    await expect(f.orchestrator.prepareApproval('other', 'call', scope)).rejects.toThrow('CUA_SCOPE_CHANGED');
    await f.orchestrator.cancelConversation('other');
    expect(f.preparations()).toBe(0);
    expect(f.cancellations()).toBe(0);
  });

  it('shares duplicate in-flight dispatch and never starts a second publication', async () => {
    const f = fixture();
    let release!: () => void;
    f.waitForPublication(new Promise<void>((resolve) => { release = resolve; }));
    await f.orchestrator.prepareApproval('a', 'call', scope);
    const first = f.orchestrator.executeApproved('a', 'call', scope);
    expect(f.orchestrator.executeApproved('a', 'call', scope)).toBe(first);
    release();
    await first;
    await expect(f.orchestrator.executeApproved('a', 'call', scope)).rejects.toThrow('CUA_APPROVAL_MISMATCH');
    expect(f.publications()).toBe(1);
  });

  it('awaits actual cancelled work and preserves its confirmed late-publication receipt', async () => {
    const f = fixture();
    let release!: () => void;
    f.waitForPublication(new Promise<void>((resolve) => { release = resolve; }));
    f.admitBeforeWait();
    await f.orchestrator.prepareApproval('a', 'call', scope);
    const execution = f.orchestrator.executeApproved('a', 'call', scope);
    await Promise.resolve();
    // Simulates cancellation after the bridge admitted publication, not a
    // cancelled permit being consumed: the real bridge owns that boundary.
    f.terminal({ status: 'persisted-after-cancel' });
    const cancelled = f.orchestrator.cancelConversation('a');
    expect(f.orchestrator.cancelConversation('a')).toBe(cancelled);
    let settled = false;
    void cancelled.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    const result = await execution;
    await cancelled;
    expect(result.status).toBe('persisted-after-cancel');
    expect(f.orchestrator.getLastResult('a')).toEqual(result);
    expect(f.cancellations()).toBe(1);
    expect(f.publications()).toBe(1);
  });

  it('keeps a completed receipt after late cancel and failed UI acknowledgement', async () => {
    const f = fixture();
    f.terminal({ uiApplied: false });
    await f.orchestrator.prepareApproval('a', 'call', scope);
    const result = await f.orchestrator.executeApproved('a', 'call', scope);
    await f.orchestrator.cancelConversation('a');
    f.orchestrator.abortRun('run');
    expect(f.orchestrator.getLastResult('a')).toEqual(result);
    expect(result.status).toBe('persisted');
    expect(result.diskMatches).toBe(true);
    expect(result.uiApplied).toBe(false);
    expect(f.publications()).toBe(1);
  });

  it('settles a not-written receipt without leaving its unused token active', async () => {
    const f = fixture();
    f.terminal({ status: 'not-written', persistedUpdatedAt: null, diskMatches: null, uiApplied: false, errorCode: 'CUA_SAVE_STALE' });
    await f.orchestrator.prepareApproval('a', 'first', scope);
    const result = await f.orchestrator.executeApproved('a', 'first', scope);
    expect(result.status).toBe('not-written');
    await f.orchestrator.prepareApproval('a', 'next', scope);
    expect(f.publications()).toBe(0);
  });

  it('uses the existing graph per-call approval, with always applying only to one Save', async () => {
    const f = fixture();
    let step = 0;
    const saveCall = (id: string) => new AIMessage({ content: '', tool_calls: [{ id, name: 'saveCuaEditorProject', args: { ...scope } }] });
    const session = new AgentChatSessionManager(buildAgentChatGraph({ tools: createCuaSaveAgentChatTools(),
      mutatingToolNames: new Set(), cuaSave: f.orchestrator,
      createModel: () => ({ invoke: async () => step++ === 0 ? saveCall('first') : step === 2 ? saveCall('second') : new AIMessage('Done') }) }));
    const pending = await session.sendMessage({ conversationId: 'a', text: 'save', modelId: 'qwen2.5-coder' });
    expect(pending.pendingApproval?.cuaApproval?.actionKind).toBe('save');
    expect(f.publications()).toBe(0);
    const second = await session.respondToApproval({ conversationId: 'a', toolCallId: 'first', decision: 'always' });
    expect(f.publications()).toBe(1);
    expect(second.pendingApproval?.toolCallId).toBe('second');
  });

  it('does not relabel a confirmed publication as failed when the active graph is cancelled', async () => {
    const f = fixture();
    let release!: () => void;
    f.waitForPublication(new Promise<void>((resolve) => { release = resolve; }));
    f.admitBeforeWait();
    let step = 0;
    const session = new AgentChatSessionManager(buildAgentChatGraph({ tools: createCuaSaveAgentChatTools(), cuaSave: f.orchestrator,
      mutatingToolNames: new Set(), createModel: () => ({ invoke: async () => step++ === 0
        ? new AIMessage({ content: '', tool_calls: [{ id: 'save', name: 'saveCuaEditorProject', args: { ...scope } }] })
        : new AIMessage('Done') }) }), { cancelCua: (id) => f.orchestrator.cancelConversation(id), getSaveResult: (id) => f.orchestrator.getLastResult(id) });
    await session.sendMessage({ conversationId: 'a', text: 'save', modelId: 'qwen2.5-coder' });
    const active = session.respondToApproval({ conversationId: 'a', toolCallId: 'save', decision: 'approve' });
    for (let i = 0; i < 100 && !f.publications(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(f.publications()).toBe(1);
    f.terminal({ status: 'persisted-after-cancel' });
    const cancel = session.cancelConversation({ conversationId: 'a' });
    release();
    const [turn, cancelled] = await Promise.all([active, cancel]);
    expect(turn.cuaSaveResult?.status).toBe('persisted-after-cancel');
    expect(turn.error).toBeUndefined();
    expect(cancelled.cuaSaveResult?.diskMatches).toBe(true);
    expect(cancelled.error).toBeUndefined();
    expect(f.publications()).toBe(1);
  });

  it('surfaces an unknown publication instead of treating a model reply as saved', async () => {
    const f = fixture();
    f.terminal({ status: 'write-outcome-unknown', persistedUpdatedAt: null, diskMatches: null, uiApplied: false, errorCode: 'publication-interrupted' });
    let step = 0;
    const session = new AgentChatSessionManager(buildAgentChatGraph({ tools: createCuaSaveAgentChatTools(), cuaSave: f.orchestrator,
      mutatingToolNames: new Set(), createModel: () => ({ invoke: async () => step++ === 0
        ? new AIMessage({ content: '', tool_calls: [{ id: 'save', name: 'saveCuaEditorProject', args: { ...scope } }] })
        : new AIMessage('Done') }) }), { getSaveResult: (id) => f.orchestrator.getLastResult(id) });
    await session.sendMessage({ conversationId: 'a', text: 'save', modelId: 'qwen2.5-coder' });
    const result = await session.respondToApproval({ conversationId: 'a', toolCallId: 'save', decision: 'approve' });
    expect(result.errorCode).toBe('CUA_SAVE_OUTCOME_UNKNOWN');
    expect(result.status).toBe('error');
    expect(result.cuaSaveResult?.status).toBe('write-outcome-unknown');
  });
});
