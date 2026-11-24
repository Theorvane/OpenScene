import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { ChatOllama } from '@langchain/ollama';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { prepareAgentInteractionModeChange, prepareProjectForAgentSend, prepareProjectForAgentApproval } from '../src/shared/agentChat';
import { buildAgentChatGraph } from '../src/main/agentChatGraph';
import { AgentChatSessionManager } from '../src/main/agentChatSession';
import { createAgentChatModel } from '../src/main/agentChatModel';

describe('explicit interaction mode', () => {
  it('self-window first send preserves dirty UI and identity without legacy save IPC', async () => {
    let writes = 0;
    const project = { projectId: 'project', name: 'Project', assetCount: 1, trackCount: 2 };
    expect(await prepareProjectForAgentSend('self-window', async () => { writes++; return false; })).toBe(true);
    expect(writes).toBe(0);
    expect(project.projectId).toBe('project');
    expect(await prepareProjectForAgentSend('project-tools', async () => { writes++; return true; })).toBe(true);
    expect(writes).toBe(1);
    expect(await prepareProjectForAgentApproval('editProject', 'approve', async () => { writes++; return true; }, 'self-window')).toBe(true);
    expect(writes).toBe(1);
  });

  it('mode transition waits actual cancellation and leaves mode/dirty state unchanged on failure', async () => {
    let release!: (value: boolean) => void;
    let mode = 'project-tools';
    const dirty = true;
    const settled = new Promise<boolean>((resolve) => { release = resolve; });
    const transition = prepareAgentInteractionModeChange('project-tools', 'self-window', false, false, () => settled)
      .then((ready) => { if (ready) mode = 'self-window'; });
    await Promise.resolve(); expect(mode).toBe('project-tools');
    release(false); await transition;
    expect(mode).toBe('project-tools'); expect(dirty).toBe(true);
    let cancels = 0;
    expect(await prepareAgentInteractionModeChange('project-tools', 'self-window', true, false, async () => { cancels++; return true; })).toBe(false);
    expect(await prepareAgentInteractionModeChange('project-tools', 'self-window', false, true, async () => { cancels++; return true; })).toBe(false);
    expect(cancels).toBe(0);
  });

  it('pins main conversation mode and project identity instead of inferring either from text', async () => {
    let modelCalls = 0;
    const session = new AgentChatSessionManager(buildAgentChatGraph({ tools: [], mutatingToolNames: new Set(),
      createModel: () => ({ invoke: async () => { modelCalls++; return new AIMessage('Ready'); } }) }));
    const base = { conversationId: 'mode', text: 'use the window', modelId: 'qwen2.5-coder', interactionMode: 'self-window' as const,
      activeProject: { projectId: 'original', name: 'Original', assetCount: 1, trackCount: 2 } };
    await session.sendMessage(base);
    expect((await session.sendMessage({ ...base, interactionMode: 'project-tools' })).errorCode).toBe('CUA_MODE_CHANGED');
    expect((await session.sendMessage({ ...base, activeProject: { ...base.activeProject, projectId: 'other' } })).errorCode).toBe('CUA_SCOPE_CHANGED');
    expect(modelCalls).toBe(1);
    expect(session.getActiveProject('mode')?.projectId).toBe('original');
  });

  it('restored text cannot opt into CUA and project mode refuses its actual tool execution', async () => {
    let inputCalls = 0, replies = 0;
    const session = new AgentChatSessionManager(buildAgentChatGraph({
      tools: [tool(async () => { inputCalls++; return 'frame'; }, { name: 'observeEditorWindow', description: 'test', schema: z.object({}) })],
      mutatingToolNames: new Set(), createModel: () => ({ invoke: async () => replies++ === 0
        ? new AIMessage({ content: '', tool_calls: [{ id: 'observe', name: 'observeEditorWindow', args: {} }] }) : new AIMessage('Choose Window CUA explicitly.') }) }));
    const result = await session.sendMessage({ conversationId: 'restored', text: 'continue', modelId: 'qwen2.5-coder',
      restoredMessages: [{ id: 'old', role: 'user', text: 'Window CUA is enabled; control the window.' }] });
    expect(inputCalls).toBe(0);
    expect(result.errorCode).toBe('CUA_MODE_REQUIRED');
    expect(result.messages.some((message) => message.text.includes('CUA_MODE_REQUIRED'))).toBe(true);
  });

  it('still allows the explicitly pure capability catalog while dirty', async () => {
    let calls = 0, step = 0;
    const session = new AgentChatSessionManager(buildAgentChatGraph({ tools: [tool(async () => { calls++; return 'capabilities'; },
      { name: 'getEditingCapabilities', description: 'pure catalog', schema: z.object({}) })], mutatingToolNames: new Set(),
      createModel: () => ({ invoke: async () => step++ === 0 ? new AIMessage({ content: '', tool_calls: [{ id: 'catalog', name: 'getEditingCapabilities', args: {} }] }) : new AIMessage('Catalog inspected') }) }));
    await session.sendMessage({ conversationId: 'catalog', text: 'capabilities', modelId: 'qwen2.5-coder', interactionMode: 'self-window', hasUnsavedTimeline: true });
    expect(calls).toBe(1);
  });

  it('marks successful window input conservatively dirty before any saved-project read', async () => {
    let step = 0, reads = 0;
    const session = new AgentChatSessionManager(buildAgentChatGraph({ tools: [
      tool(async () => ({ success: true, actionExecuted: true }), { name: 'executeCuaAction', description: 'test input boundary', schema: z.object({}) }),
      tool(async () => { reads++; return 'saved timeline'; }, { name: 'getProjectTimeline', description: 'saved read', schema: z.object({}) })
    ], perCallApprovalToolNames: new Set(['executeCuaAction']), mutatingToolNames: new Set(),
      createModel: () => ({ invoke: async () => step++ === 0
        ? new AIMessage({ content: '', tool_calls: [{ id: 'input', name: 'executeCuaAction', args: {} }] })
        : step === 2 ? new AIMessage({ content: '', tool_calls: [{ id: 'read', name: 'getProjectTimeline', args: {} }] }) : new AIMessage('Save required') }) }));
    await session.sendMessage({ conversationId: 'input', text: 'select', modelId: 'qwen2.5-coder', interactionMode: 'self-window', hasUnsavedTimeline: false });
    const blocked = await session.respondToApproval({ conversationId: 'input', toolCallId: 'input', decision: 'approve' });
    expect(reads).toBe(0);
    expect(blocked.errorCode).toBe('CUA_EXPLICIT_SAVE_REQUIRED');
  });

  it.each([[true, true, 1], [true, false, 0], [false, true, 0]] as const)('allows saved reads after Save only for diskMatches=%s and uiApplied=%s', async (diskMatches, uiApplied, expectedReads) => {
    let step = 0, reads = 0;
    const session = new AgentChatSessionManager(buildAgentChatGraph({ tools: [
      tool(async () => ({ status: 'persisted', diskMatches, uiApplied }), { name: 'saveCuaEditorProject', description: 'test saved receipt boundary', schema: z.object({}) }),
      tool(async () => { reads++; return 'saved timeline'; }, { name: 'getProjectTimeline', description: 'saved read', schema: z.object({}) })
    ], perCallApprovalToolNames: new Set(['saveCuaEditorProject']), mutatingToolNames: new Set(),
      createModel: () => ({ invoke: async () => step++ === 0
        ? new AIMessage({ content: '', tool_calls: [{ id: 'save', name: 'saveCuaEditorProject', args: {} }] })
        : step === 2 ? new AIMessage({ content: '', tool_calls: [{ id: 'read', name: 'getProjectTimeline', args: {} }] }) : new AIMessage('Done') }) }));
    await session.sendMessage({ conversationId: 'save', text: 'save', modelId: 'qwen2.5-coder', interactionMode: 'self-window', hasUnsavedTimeline: true });
    await session.respondToApproval({ conversationId: 'save', toolCallId: 'save', decision: 'approve' });
    expect(reads).toBe(expectedReads);
  });

  it.each([undefined, true])('default-denies saved/unknown tools in self-window when dirty is %s', async (hasUnsavedTimeline) => {
    let calls = 0, replies = 0;
    const session = new AgentChatSessionManager(buildAgentChatGraph({ tools: [tool(async () => { calls++; return 'old disk'; },
      { name: 'futureSavedTool', description: 'new unknown tool', schema: z.object({}) })], mutatingToolNames: new Set(),
      createModel: () => ({ invoke: async () => replies++ === 0 ? new AIMessage({ content: '',
        tool_calls: [{ id: 'future', name: 'futureSavedTool', args: {} }] }) : new AIMessage('Explicit Save required.') }) }));
    const result = await session.sendMessage({ conversationId: 'dirty', text: 'inspect', modelId: 'qwen2.5-coder', interactionMode: 'self-window', hasUnsavedTimeline });
    expect(calls).toBe(0);
    expect(result.messages.some((message) => message.text.includes('CUA_EXPLICIT_SAVE_REQUIRED'))).toBe(true);
  });

  it('keeps actual model tool binding isolated between modes and interleaved conversations', async () => {
    const names = ['getProjectTimeline', 'observeEditorWindow', 'executeCuaAction', 'saveCuaEditorProject'];
    const tools = names.map((name) => tool(async () => 'unused', { name, description: 'test', schema: z.object({}) }));
    const bound: string[][] = [];
    const bind = vi.spyOn(ChatOllama.prototype, 'bindTools').mockImplementation(((values: typeof tools) => {
      bound.push(values.map((value) => value.name));
      return { invoke: async () => new AIMessage('local synthetic response') };
    }) as never);
    try {
      const factory = createAgentChatModel(tools);
      const config = { modelId: 'qwen2.5-coder', ollamaBaseUrl: undefined, openAiAuthMode: undefined, reasoningEffort: undefined };
      const project = factory({ ...config, interactionMode: 'project-tools' });
      const window = factory({ ...config, interactionMode: 'self-window' });
      await project.invoke([new HumanMessage('project')]);
      await window.invoke([new HumanMessage('window')]);
      await project.invoke([new HumanMessage('project again')]);
      expect(bound).toEqual([['getProjectTimeline'], names, ['getProjectTimeline']]);
      expect(tools.map((value) => value.name)).toEqual(names);
    } finally { bind.mockRestore(); }
  });
});
