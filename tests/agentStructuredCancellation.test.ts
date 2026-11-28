import { AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { expect, it } from 'vitest';
import { buildAgentChatGraph } from '../src/main/agentChatGraph';
import { AgentChatSessionManager } from '../src/main/agentChatSession';

it('retains a pending structured edit approval and cancels it without executing the edit', async () => {
  let edits = 0;
  const edit = tool(async () => { edits++; return 'done'; }, { name: 'editProject', description: 'fixture edit', schema: z.object({}) });
  const session = new AgentChatSessionManager(buildAgentChatGraph({ tools: [edit], mutatingToolNames: new Set(['editProject']), createModel: () => ({ invoke: async () => new AIMessage({ content: '', tool_calls: [{ id: 'one', name: 'editProject', args: {} }] }) }) }));
  const input = { conversationId: 'fixture', text: 'trim', modelId: 'fixture' };
  expect((await session.sendMessage(input)).pendingApproval?.toolCallId).toBe('one');
  expect((await session.compactConversation(input)).pendingApproval?.toolCallId).toBe('one');
  expect((await session.sendMessage({ ...input, text: 'replace' })).pendingApproval?.toolCallId).toBe('one');
  const cancelled = await session.cancelConversation(input);
  expect(cancelled.status).toBe('idle');
  expect(cancelled.pendingApproval).toBeNull();
  expect(edits).toBe(0);
});

it('aborts an active model request and permits a new request after cancellation settles', async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let aborted = false; let requests = 0;
  const session = new AgentChatSessionManager(buildAgentChatGraph({ tools: [], mutatingToolNames: new Set(), createModel: () => ({ invoke: async (_messages, options) => {
    if (requests++ > 0) return new AIMessage('Ready');
    started();
    return await new Promise((_resolve, reject) => { options!.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('Aborted')); }, { once: true }); });
  } }) }));
  const input = { conversationId: 'fixture', text: 'trim', modelId: 'fixture' };
  const running = session.sendMessage(input); await ready;
  expect((await session.cancelConversation(input)).status).toBe('idle');
  await running;
  expect(aborted).toBe(true);
  expect((await session.sendMessage(input)).messages.at(-1)?.text).toBe('Ready');
});
