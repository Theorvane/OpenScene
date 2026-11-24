import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import type { AgentChatHistoryGetInput, AgentChatTurnState } from '../shared/agentChat';
import { IPC_CHANNELS } from '../shared/ipc';
import { fail, ok } from './ipcResponses';
import type { AgentChatHistoryStore } from './agentChatHistoryStore';
import type { AgentChatSessionManager } from './agentChatSession';

export function registerAgentChatIpcHandlers(
  ipcMain: IpcMain,
  sessions: AgentChatSessionManager,
  history: AgentChatHistoryStore | null = null,
  options: {
    readonly cancelChannel?: string;
    readonly isTrustedSender?: (event: IpcMainInvokeEvent) => boolean;
  } = {}
): void {
  const recordTurn = async (turn: AgentChatTurnState): Promise<void> => {
    if (history === null || turn.messages.length === 0) return;
    const activeProject = sessions.getActiveProject(turn.conversationId);
    if (activeProject === null) return;
    try {
      await history.record({
        projectId: activeProject.projectId,
        conversationId: turn.conversationId,
        messages: turn.messages
      });
    } catch {
      // Persisting history must never fail the chat turn itself.
    }
  };

  ipcMain.handle(IPC_CHANNELS.agentChatSend, async (_event, request) => {
    if (options.isTrustedSender && !options.isTrustedSender(_event)) return fail('INVALID_INPUT', 'Untrusted agent chat sender');
    try {
      const turn = await sessions.sendMessage(request);
      await recordTurn(turn);
      return ok(turn);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to send agent chat message');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatApprove, async (_event, request) => {
    if (options.isTrustedSender && !options.isTrustedSender(_event)) return fail('INVALID_INPUT', 'Untrusted approval sender');
    try {
      const turn = await sessions.respondToApproval(request);
      await recordTurn(turn);
      return ok(turn);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to record agent chat approval');
    }
  });

  if (options.cancelChannel) ipcMain.handle(options.cancelChannel, async (event, request) => {
    if (!options.isTrustedSender?.(event)) return fail('INVALID_INPUT', 'Untrusted cancellation sender');
    if (!request || typeof request.conversationId !== 'string' || !request.conversationId.trim()
      || request.conversationId.length > 256) return fail('INVALID_INPUT', 'Invalid cancellation conversation');
    try {
      return ok(await sessions.cancelConversation({ conversationId: request.conversationId }));
    } catch (error) {
      return fail('UNKNOWN_ERROR', error instanceof Error ? error.message : 'Failed to settle agent cancellation');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatCompact, async (_event, request) => {
    if (options.isTrustedSender && !options.isTrustedSender(_event)) return fail('INVALID_INPUT', 'Untrusted agent chat sender');
    try {
      const turn = await sessions.compactConversation(request);
      await recordTurn(turn);
      return ok(turn);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to compact the agent conversation');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatReset, async (_event, request) => {
    if (options.isTrustedSender && !options.isTrustedSender(_event)) return fail('INVALID_INPUT', 'Untrusted agent chat sender');
    try {
      return ok(await sessions.resetConversation(request));
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to reset agent chat conversation');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatHistoryList, async () => {
    if (history === null) return ok([]);
    try {
      return ok(await history.listAllProjects());
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to list agent chat history');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatHistoryDelete, async (_event, request) => {
    if (options.isTrustedSender && !options.isTrustedSender(_event)) return fail('INVALID_INPUT', 'Untrusted agent chat sender');
    if (history === null) return ok(false);
    const input = request as Partial<AgentChatHistoryGetInput> | undefined;
    if (typeof input?.projectId !== 'string' || typeof input.conversationId !== 'string') {
      return fail('INVALID_INPUT', 'The chat history delete payload was not valid.');
    }
    try {
      // Drop the in-memory thread too, so a deleted conversation cannot be
      // resumed by a panel still pointing at that id.
      await sessions.resetConversation({ conversationId: input.conversationId });
      return ok(await history.delete(input.projectId, input.conversationId));
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to delete the agent chat conversation');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatHistoryGet, async (_event, request) => {
    if (history === null) return ok(null);
    const input = request as Partial<AgentChatHistoryGetInput> | undefined;
    if (typeof input?.projectId !== 'string' || typeof input.conversationId !== 'string') {
      return fail('INVALID_INPUT', 'The chat history lookup payload was not valid.');
    }
    try {
      return ok(await history.get(input.projectId, input.conversationId));
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to load the agent chat conversation');
    }
  });
}
