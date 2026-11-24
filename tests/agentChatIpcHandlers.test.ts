import { describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
import { registerAgentChatIpcHandlers } from '../src/main/agentChatIpcHandlers';
import { IPC_CHANNELS } from '../src/shared/ipc';
import type { AgentChatSessionManager } from '../src/main/agentChatSession';
import type { AgentChatTurnState } from '../src/shared/agentChat';

type Listener = (event: unknown, ...args: unknown[]) => unknown;

function createFakeIpcMain(): { ipcMain: IpcMain; handlers: Map<string, Listener> } {
  const handlers = new Map<string, Listener>();
  const ipcMain = {
    handle: (channel: string, listener: Listener) => {
      handlers.set(channel, listener);
    }
  } as unknown as IpcMain;
  return { ipcMain, handlers };
}

const RESET_STATE: AgentChatTurnState = { conversationId: 'c1', messages: [], pendingApproval: null, status: 'idle' };

describe('registerAgentChatIpcHandlers', () => {
  it('checks trusted ownership before cancel or approval and awaits cancellation settlement', async () => {
    const { ipcMain, handlers } = createFakeIpcMain();
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const cancelConversation = vi.fn(async () => { await released; return RESET_STATE; });
    const respondToApproval = vi.fn();
    const sessions = { cancelConversation, respondToApproval } as unknown as AgentChatSessionManager;
    const trusted = {};
    registerAgentChatIpcHandlers(ipcMain, sessions, null, { cancelChannel: 'test:cancel', isTrustedSender: (event) => event === trusted });
    const cancel = handlers.get('test:cancel')!;
    expect(await cancel({}, { conversationId: 'c1' })).toMatchObject({ ok: false });
    expect(await cancel(trusted, { conversationId: '' })).toMatchObject({ ok: false });
    expect(await handlers.get(IPC_CHANNELS.agentChatApprove)!({}, {})).toMatchObject({ ok: false });
    expect(respondToApproval).not.toHaveBeenCalled();
    expect(cancelConversation).not.toHaveBeenCalled();
    let settled = false;
    const result = Promise.resolve(cancel(trusted, { conversationId: 'c1' })).then((response) => { settled = true; return response; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect(await result).toEqual({ ok: true, value: RESET_STATE });
  });

  it('resolves the resetConversation promise before wrapping it in ok() for the reset channel', async () => {
    const { ipcMain, handlers } = createFakeIpcMain();
    const sessions = {
      sendMessage: vi.fn(),
      respondToApproval: vi.fn(),
      // Reproduces the async, checkpointer-clearing reset — a caller that forgets to
      // await this must not leak the raw Promise into the IPC response's `value`.
      resetConversation: vi.fn(async () => {
        await Promise.resolve();
        return RESET_STATE;
      })
    } as unknown as AgentChatSessionManager;

    registerAgentChatIpcHandlers(ipcMain, sessions);
    const resetHandler = handlers.get(IPC_CHANNELS.agentChatReset);
    expect(resetHandler).toBeDefined();

    const response = await resetHandler!(null, { conversationId: 'c1' });

    expect(response).toEqual({ ok: true, value: RESET_STATE });
    // Guards specifically against `ok(sessions.resetConversation(request))` (missing await),
    // which would put an unresolved Promise in `value` instead of the turn state.
    expect(response).not.toHaveProperty('value.then');
    expect((response as { ok: true; value: AgentChatTurnState }).value.status).toBe('idle');
  });

  it('reports a failed reset as an error response instead of throwing', async () => {
    const { ipcMain, handlers } = createFakeIpcMain();
    const sessions = {
      sendMessage: vi.fn(),
      respondToApproval: vi.fn(),
      resetConversation: vi.fn(async () => {
        throw new Error('checkpointer unavailable');
      })
    } as unknown as AgentChatSessionManager;

    registerAgentChatIpcHandlers(ipcMain, sessions);
    const resetHandler = handlers.get(IPC_CHANNELS.agentChatReset)!;

    const response = await resetHandler(null, { conversationId: 'c1' });

    expect(response).toEqual({ ok: false, error: { code: 'UNKNOWN_ERROR', message: 'checkpointer unavailable' } });
  });

  it('resolves the sendMessage promise before wrapping it for the send channel', async () => {
    const { ipcMain, handlers } = createFakeIpcMain();
    const turnState: AgentChatTurnState = { conversationId: 'c1', messages: [], pendingApproval: null, status: 'thinking' };
    const sessions = {
      sendMessage: vi.fn(async () => turnState),
      respondToApproval: vi.fn(),
      resetConversation: vi.fn()
    } as unknown as AgentChatSessionManager;

    registerAgentChatIpcHandlers(ipcMain, sessions);
    const sendHandler = handlers.get(IPC_CHANNELS.agentChatSend)!;

    const response = await sendHandler(null, { conversationId: 'c1', text: 'hi', modelId: 'qwen2.5-coder' });

    expect(response).toEqual({ ok: true, value: turnState });
  });
});
