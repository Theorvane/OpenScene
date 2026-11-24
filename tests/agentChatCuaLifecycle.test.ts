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

  it('reports failed release and does not delete the pending checkpoint as success', async () => {
    const { session } = fixture([call('one')], { cancelCua: async () => { throw new Error('release failed'); } });
    await session.sendMessage(send);
    const result = await session.cancelConversation(send);
    expect(result.errorCode).toBe('CUA_CLEANUP_FAILED');
    expect(result.status).toBe('error');
  });
});
