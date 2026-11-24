import { AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { buildAgentChatGraph } from '../src/main/agentChatGraph';
import { AgentChatSessionManager } from '../src/main/agentChatSession';

const call = (id: string) => new AIMessage({ content: '', tool_calls: [{ id, name: 'cuaAction', args: {} }] });
function fixture(replies: AIMessage[], options: { cancelCua?: (id: string) => Promise<void> } = {}) {
  let inputs = 0;
  let index = 0;
  const bundle = buildAgentChatGraph({
    tools: [tool(async () => { inputs++; return 'done'; }, { name: 'cuaAction', description: 'test CUA', schema: z.object({}) })],
    mutatingToolNames: new Set(), // Per-call policy must fail closed even if this list is wrong.
    perCallApprovalToolNames: new Set(['cuaAction']),
    createModel: () => ({ invoke: async () => replies[index++] ?? new AIMessage('Done') })
  });
  return { session: new AgentChatSessionManager(bundle, options), inputs: () => inputs };
}
const send = { conversationId: 'conversation', text: 'move clip', modelId: 'qwen2.5-coder' };

describe('CUA graph approval and cancellation lifecycle', () => {
  it('rejects another send while approval is pending without replacing its project scope', async () => {
    const { session, inputs } = fixture([call('one'), new AIMessage('Done')]);
    await session.sendMessage({ ...send, activeProject: { projectId: 'original', name: 'Original', assetCount: 0, trackCount: 2 } });
    const blocked = await session.sendMessage({ ...send, text: 'new request', activeProject: { projectId: 'other', name: 'Other', assetCount: 0, trackCount: 2 } });
    expect(blocked.pendingApproval?.toolCallId).toBe('one');
    expect(blocked.error).toContain('current approval');
    expect(session.getActiveProject(send.conversationId)?.projectId).toBe('original');
    await session.respondToApproval({ conversationId: send.conversationId, toolCallId: 'one', decision: 'approve' });
    expect(inputs()).toBe(1);
  });

  it.each([
    ['write', 'cuaAction'], ['cuaAction', 'write'],
    ['observeEditorWindow', 'cuaAction'], ['observeEditorWindow', 'read'],
    ['cuaAction', 'cuaAction']
  ])('rejects the entire mixed step %s + %s before any tool or approval', async (first, second) => {
    let calls = 0;
    let modelCalls = 0;
    const tools = [...new Set([first, second])].map((name) => tool(async () => { calls++; return 'ran'; }, { name, description: 'test', schema: z.object({}) }));
    const session = new AgentChatSessionManager(buildAgentChatGraph({ tools, mutatingToolNames: new Set(['write']),
      perCallApprovalToolNames: new Set(['cuaAction']), createModel: () => ({ invoke: async () => modelCalls++ === 0
        ? new AIMessage({ content: '', tool_calls: [first, second].map((name, index) => ({ id: `call-${index}`, name, args: {} })) })
        : new AIMessage('I will observe and act in separate steps.') }) }));
    const result = await session.sendMessage(send);
    expect(result.status).toBe('idle');
    expect(result.pendingApproval).toBeNull();
    expect(calls).toBe(0);
    expect(result.messages.filter((message) => message.role === 'tool')).toHaveLength(2);
    expect(result.messages.filter((message) => message.role === 'tool').every((message) => message.text.includes('No tool in this step ran'))).toBe(true);
  });

  it('bounds an autonomous observation loop without issuing any write approval', async () => {
    let calls = 0;
    const session = new AgentChatSessionManager(buildAgentChatGraph({
      tools: [tool(async () => { calls++; return 'observation'; }, { name: 'observeEditorWindow', description: 'test', schema: z.object({}) })],
      mutatingToolNames: new Set(), createModel: () => ({ invoke: async () => new AIMessage({ content: '',
        tool_calls: [{ id: `observe-${calls}`, name: 'observeEditorWindow', args: {} }] }) })
    }));
    const result = await session.sendMessage(send);
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/recursion|limit/i);
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(16);
  });

  it('recovers from a rejected mixed step only through a fresh, separately approved call', async () => {
    const mixed = new AIMessage({ content: '', tool_calls: [
      { id: 'old-action', name: 'cuaAction', args: {} },
      { id: 'old-read', name: 'observeEditorWindow', args: {} }
    ] });
    const { session, inputs } = fixture([mixed, call('fresh-action'), new AIMessage('Done')]);
    const pending = await session.sendMessage(send);
    expect(inputs()).toBe(0);
    expect(pending.pendingApproval?.toolCallId).toBe('fresh-action');
    await session.respondToApproval({ conversationId: send.conversationId, toolCallId: 'old-action', decision: 'approve' });
    expect(inputs()).toBe(0);
    await session.respondToApproval({ conversationId: send.conversationId, toolCallId: 'fresh-action', decision: 'approve' });
    expect(inputs()).toBe(1);
  });

  it('always authorizes only the exact CUA call and prompts again for the next', async () => {
    const { session, inputs } = fixture([call('one'), call('two'), new AIMessage('Done')]);
    await session.sendMessage(send);
    const next = await session.respondToApproval({ conversationId: send.conversationId, toolCallId: 'one', decision: 'always' });
    expect(inputs()).toBe(1);
    expect(next.pendingApproval?.toolCallId).toBe('two');
    await session.respondToApproval({ conversationId: send.conversationId, toolCallId: 'two', decision: 'deny' });
    expect(inputs()).toBe(1);
  });

  it('denial executes zero inputs and reused call IDs never execute', async () => {
    const { session, inputs } = fixture([call('one'), call('one'), new AIMessage('Done')]);
    await session.sendMessage(send);
    const result = await session.respondToApproval({ conversationId: send.conversationId, toolCallId: 'one', decision: 'deny' });
    expect(inputs()).toBe(0);
    expect(result.messages.some((message) => message.text.includes('CUA_ACTION_REPLAYED'))).toBe(true);
  });

  it('concurrent approvals execute once and the second request is busy', async () => {
    const { session, inputs } = fixture([call('one'), new AIMessage('Done')]);
    await session.sendMessage(send);
    const approve = { conversationId: send.conversationId, toolCallId: 'one', decision: 'approve' as const };
    const results = await Promise.all([session.respondToApproval(approve), session.respondToApproval(approve)]);
    expect(inputs()).toBe(1);
    expect(results.some((result) => result.errorCode === 'CUA_BUSY')).toBe(true);
  });

  it('shares cancel settlement and does not accept approval before release completes', async () => {
    let release!: () => void;
    let cancels = 0;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const { session, inputs } = fixture([call('one')], { cancelCua: async () => { cancels++; await released; } });
    await session.sendMessage(send);
    const first = session.cancelConversation(send);
    expect(session.cancelConversation(send)).toBe(first);
    const blocked = await session.respondToApproval({ conversationId: send.conversationId, toolCallId: 'one', decision: 'approve' });
    expect(blocked.errorCode).toBe('CUA_BUSY');
    expect(inputs()).toBe(0);
    release();
    await first;
    expect(cancels).toBe(1);
    const stale = await session.respondToApproval({ conversationId: send.conversationId, toolCallId: 'one', decision: 'approve' });
    expect(stale.error).toContain('no longer matches');
    expect(inputs()).toBe(0);
  });

  it('aborts a running model before waiting for actual input release', async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let aborted = false;
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const bundle = buildAgentChatGraph({ tools: [], mutatingToolNames: new Set(), createModel: () => ({
      invoke: async (_messages, options) => new Promise<AIMessage>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
        started();
      })
    }) });
    const session = new AgentChatSessionManager(bundle, { cancelCua: async () => { expect(aborted).toBe(true); await released; } });
    const turn = session.sendMessage(send);
    await ready;
    const cancel = session.cancelConversation(send);
    expect(aborted).toBe(true);
    let settled = false;
    void cancel.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await Promise.all([turn, cancel]);
    expect(settled).toBe(true);
  });

  it('does not return an aborted active tool turn before its actual release settles', async () => {
    let entered!: () => void;
    let release!: () => void;
    let held = 0;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    let modelStep = 0;
    const bundle = buildAgentChatGraph({
      tools: [tool(async () => { held = 1; entered(); await released; held = 0; throw new Error('CUA_CANCELLED'); }, {
        name: 'cuaAction', description: 'delayed held input', schema: z.object({})
      })], mutatingToolNames: new Set(['cuaAction']), perCallApprovalToolNames: new Set(['cuaAction']),
      createModel: () => ({ invoke: async () => modelStep++ === 0 ? call('active') : new AIMessage('Done') })
    });
    const session = new AgentChatSessionManager(bundle, { cancelCua: async () => { await released; held = 0; } });
    await session.sendMessage(send);
    const turn = session.respondToApproval({ conversationId: send.conversationId, toolCallId: 'active', decision: 'approve' });
    await started;
    session.abortConversation(send.conversationId); // Trusted driver callback, no recursive cancel.
    let settled = false;
    void turn.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    expect(held).toBe(1);
    release();
    await turn;
    expect(held).toBe(0);
  });

  it('reports failed release and does not delete the pending checkpoint as success', async () => {
    const { session } = fixture([call('one')], { cancelCua: async () => { throw new Error('release failed'); } });
    await session.sendMessage(send);
    const result = await session.cancelConversation(send);
    expect(result.errorCode).toBe('CUA_CLEANUP_FAILED');
    expect(result.status).toBe('error');
  });
});
