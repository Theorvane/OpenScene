import { AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { CuaAgentOrchestrator, CuaApprovalAuthority, type CuaAgentDriver } from '../src/main/cuaAgentOrchestration';
import type { CuaActionRequest, CuaDispatchReceipt, CuaState } from '../src/shared/cua';
import { buildAgentChatGraph } from '../src/main/agentChatGraph';
import { AgentChatSessionManager } from '../src/main/agentChatSession';

function fixture() {
  const authority = new CuaApprovalAuthority({ now: () => 0, permitTtlMs: 100, maxActionsPerRun: 10 });
  let state: CuaState = { sessionId: null, runId: null, windowId: 1, phase: 'idle', prepareToken: null,
    cancelToken: null, targetGone: false, cursor: null, dragStart: null, target: null, label: null,
    error: null, cleanupComplete: true, releaseFailures: [] };
  let sequence = 0;
  let session: AgentChatSessionManager | undefined;
  const driver: CuaAgentDriver = {
    observe: async scope => {
      state = { ...state, ...scope, phase: 'ready' };
      return { ...scope, windowId: 1, frameId: `frame-${++sequence}`, layoutRevision: 1, contentRevision: sequence,
        capturedAt: 0, viewport: { width: 100, height: 100 }, bitmap: { width: 100, height: 100 },
        deviceScaleFactor: 1, zoomFactor: 1, pngDataUrl: 'data:image/png;base64,AAAA' };
    },
    execute: async () => state,
    cancel: async () => { state = { ...state, phase: 'stopped' }; orchestrator.settleRun(state); return state; },
    getState: () => structuredClone(state), setExecutionBlocked: () => undefined,
    getLastDispatchReceipt: scope => state.lastDispatchReceipt?.runId === scope.runId ? structuredClone(state.lastDispatchReceipt) : null
  };
  const orchestrator = new CuaAgentOrchestrator(authority, { driver, onAbortConversation: id => session?.abortConversation(id) });
  const prepare = async (conversationId = 'a', toolCallId = `call-${sequence}`) => {
    const { frame } = await orchestrator.observe(conversationId);
    const { pngDataUrl: _png, ...scope } = frame;
    const request: CuaActionRequest = { sessionId: scope.sessionId, runId: scope.runId, windowId: scope.windowId, frameId: scope.frameId, layoutRevision: scope.layoutRevision, contentRevision: scope.contentRevision, action: { kind: 'drag', from: { x: 10, y: 10 }, to: { x: 20, y: 10 }, durationMs: 600 } };
    orchestrator.prepareApproval(conversationId, toolCallId, request);
    return { request, toolCallId };
  };
  const receipt = (request: CuaActionRequest, patch: Partial<CuaDispatchReceipt> = {}): CuaDispatchReceipt => ({
    actionId: `action-${sequence}`, actionKind: request.action.kind, sessionId: request.sessionId, runId: request.runId,
    windowId: request.windowId, frameId: request.frameId, layoutRevision: request.layoutRevision,
    contentRevision: request.contentRevision, generation: sequence, dispatch: 'full-dispatch', expectedEvents: 64,
    attemptedEvents: 64, returnedEvents: 64, dispatchUncertain: false,
    release: { attemptedEvents: 1, returnedEvents: 1, heldInputCount: 0, failures: [] },
    rendererSettlement: 'acknowledged', observationReady: true, ...patch
  });
  const publish = (value: CuaDispatchReceipt, patch: Partial<CuaState> = {}) => {
    state = { ...state, ...patch, lastDispatchReceipt: value }; orchestrator.settleRun(state);
  };
  return { driver, authority, orchestrator, prepare, receipt, publish, state: () => state,
    connectSession: (value: AgentChatSessionManager) => { session = value; } };
}

describe('main terminal dispatch receipt', () => {
  it.each([
    ['no-attempt abort', { dispatch: 'no-dispatch', attemptedEvents: 0, returnedEvents: 0, rendererSettlement: 'cancelled', observationReady: false }, true],
    ['partial Stop', { dispatch: 'partial-dispatch', attemptedEvents: 9, returnedEvents: 8, dispatchUncertain: true, rendererSettlement: 'cancelled', observationReady: false }, true],
    ['full release ACK timeout', { rendererSettlement: 'timed-out', observationReady: false }, false]
  ] as const)('preserves %s after run deletion without claiming settled success', async (_name, patch, throws) => {
    const f = fixture(), { request, toolCallId } = await f.prepare();
    f.driver.execute = async () => {
      f.publish(f.receipt(request, patch), { phase: 'stopped' });
      if (throws) throw new Error('CUA_CANCELLED');
      return f.state();
    };
    if (throws) await expect(f.orchestrator.executeApproved('a', toolCallId, request)).rejects.toThrow('CUA_CANCELLED');
    else expect(await f.orchestrator.executeApproved('a', toolCallId, request)).toMatchObject({ success: false, observationReady: false, actionExecuted: true });
    expect(f.orchestrator.getLastActionResult('a')).toMatchObject({ toolCallId, receipt: patch });
    await f.orchestrator.cancelConversation('a');
    expect(f.orchestrator.getLastActionResult('a')?.receipt.dispatch).toBe(('dispatch' in patch ? patch.dispatch : 'full-dispatch'));
  });

  it('keeps dispatch facts after acknowledged input, late cancel and clone mutation; isolates a new run', async () => {
    const f = fixture(), { request, toolCallId } = await f.prepare();
    f.driver.execute = async () => { f.publish(f.receipt(request)); return f.state(); };
    const result = await f.orchestrator.executeApproved('a', toolCallId, request);
    expect(result).toMatchObject({ success: true, observationReady: true });
    await f.orchestrator.cancelConversation('a');
    expect(f.orchestrator.getLastActionResult('a')?.receipt.rendererSettlement).toBe('acknowledged');
    const copy = f.orchestrator.getLastActionResult('a')!;
    (copy.receipt.release.failures as string[]).push('poison');
    expect(f.orchestrator.getLastActionResult('a')?.receipt.release.failures).toEqual([]);
    await f.prepare('a', 'new-run');
    expect(f.orchestrator.getLastActionResult('a')).toBeNull();
    f.publish(f.receipt(request), { phase: 'ready' });
    expect(f.orchestrator.getLastActionResult('a')).toBeNull();
  });

  it('rejects regressive or foreign action receipts and strips private fields', async () => {
    const f = fixture(), { request, toolCallId } = await f.prepare();
    f.driver.execute = async () => {
      f.publish({ ...f.receipt(request), settlementToken: 'private', pngDataUrl: 'private' } as CuaDispatchReceipt);
      f.publish(f.receipt(request, { returnedEvents: 1 }));
      f.publish(f.receipt(request, { actionId: 'another-action' }));
      return f.state();
    };
    await f.orchestrator.executeApproved('a', toolCallId, request);
    const result = f.orchestrator.getLastActionResult('a')!;
    expect(result.receipt.returnedEvents).toBe(64);
    expect(result.receipt.actionId).not.toBe('another-action');
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('preserves cleanup failure receipt in terminal session results and after checkpoint deletion', async () => {
    const f = fixture(), { request, toolCallId } = await f.prepare();
    f.driver.execute = async () => {
      f.publish(f.receipt(request, { dispatch: 'partial-dispatch', rendererSettlement: 'cancelled', observationReady: false,
        release: { attemptedEvents: 1, returnedEvents: 0, heldInputCount: 1, failures: ['mouse-release-failed'] } }), { phase: 'cleanup-failed', cleanupComplete: false });
      return f.state();
    };
    await expect(f.orchestrator.executeApproved('a', toolCallId, request)).rejects.toThrow('CUA_CLEANUP_FAILED');
    const bundle = buildAgentChatGraph({ tools: [], mutatingToolNames: new Set(), cua: f.orchestrator,
      createModel: () => ({ invoke: async () => new AIMessage('done') }) });
    const session = new AgentChatSessionManager(bundle, { cancelCua: async () => { throw new Error('release failed'); } });
    const terminal = await session.cancelConversation({ conversationId: 'a' });
    expect(terminal.errorCode).toBe('CUA_CLEANUP_FAILED');
    expect(terminal.cuaActionResult?.receipt.release.heldInputCount).toBe(1);
    await bundle.checkpointer.deleteThread('a');
    const later = await session.sendMessage({ conversationId: 'a', text: 'continue', modelId: 'qwen2.5-coder' });
    expect(later.cuaActionResult?.receipt.dispatch).toBe('partial-dispatch');
    expect(later.errorCode).toBe('CUA_CLEANUP_FAILED');
  });
  it('waits actual release after early graph abort and preserves receipt across cancel checkpoint deletion', async () => {
    const f = fixture(), { request } = await f.prepare('a', 'early');
    let release!: () => void, entered!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let calls = 0;
    const { createCuaAgentChatTools, AGENT_CHAT_CUA_PER_CALL_TOOL_NAMES } = await import('../src/main/agentChatTools');
    const bundle = buildAgentChatGraph({ tools: createCuaAgentChatTools(f.orchestrator),
      mutatingToolNames: new Set(['executeCuaAction']), perCallApprovalToolNames: AGENT_CHAT_CUA_PER_CALL_TOOL_NAMES,
      cua: f.orchestrator, createModel: () => ({ invoke: async () => {
        calls++; return new AIMessage({ content: '', tool_calls: [{ id: 'early', name: 'executeCuaAction', args: request }] });
      } }) });
    f.driver.execute = async () => {
      f.publish(f.receipt(request, { dispatch: 'partial-dispatch', attemptedEvents: 8, returnedEvents: 8,
        rendererSettlement: 'pending', observationReady: false,
        release: { attemptedEvents: 0, returnedEvents: 0, heldInputCount: 1, failures: [] } }));
      entered();
      f.orchestrator.abortRun(request.runId);
      await released;
      f.publish(f.receipt(request, { dispatch: 'partial-dispatch', attemptedEvents: 8, returnedEvents: 8,
        rendererSettlement: 'cancelled', observationReady: false }), { phase: 'stopped' });
      return f.state();
    };
    f.driver.cancel = async () => { await released; return f.state(); };
    const session = new AgentChatSessionManager(bundle, { cancelCua: id => f.orchestrator.cancelConversation(id) });
    f.connectSession(session);
    expect((await session.sendMessage({ conversationId: 'a', text: 'drag', modelId: 'qwen2.5-coder', interactionMode: 'self-window' })).pendingApproval?.toolCallId).toBe('early');
    let terminalReturned = false;
    const pending = session.respondToApproval({ conversationId: 'a', toolCallId: 'early', decision: 'approve' }).then(value => { terminalReturned = true; return value; });
    await started;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(terminalReturned).toBe(false);
    release();
    const terminal = await pending;
    expect(terminal.messages.some(message => message.toolName === 'executeCuaAction' && message.text.includes('partial-dispatch'))).toBe(true);
    expect(terminal.cuaActionResult?.receipt).toMatchObject({ dispatch: 'partial-dispatch', rendererSettlement: 'cancelled', release: { heldInputCount: 0 } });
    const cancelled = await session.cancelConversation({ conversationId: 'a' });
    expect(cancelled.cuaActionResult?.receipt.actionId).toBe(terminal.cuaActionResult?.receipt.actionId);
    expect((await bundle.graph.getState({ configurable: { thread_id: 'a' } })).values).toEqual({});
    expect(calls).toBe(1); // No provider retry after a partial dispatch.
  });

  it('keeps partial input dirty after cancellation even with a client clean flag and an older verified Save', async () => {
    const f = fixture(), { request, toolCallId } = await f.prepare();
    f.driver.execute = async () => {
      f.publish(f.receipt(request, { dispatch: 'partial-dispatch', rendererSettlement: 'cancelled', observationReady: false }), { phase: 'stopped' });
      return f.state();
    };
    await f.orchestrator.executeApproved('a', toolCallId, request);
    let saveToken = 'older-save', reads = 0, modelCalls = 0;
    const bundle = buildAgentChatGraph({ cua: f.orchestrator, mutatingToolNames: new Set(),
      tools: [tool(async () => { reads++; return 'saved'; }, { name: 'getProjectTimeline', description: 'saved read', schema: z.object({}) })],
      createModel: () => ({ invoke: async () => ++modelCalls % 2
        ? new AIMessage({ content: '', tool_calls: [{ id: `read-${modelCalls}`, name: 'getProjectTimeline', args: {} }] }) : new AIMessage('done') }) });
    const session = new AgentChatSessionManager(bundle, { getSaveResult: () => ({ saveToken,
      runId: request.runId, projectId: 'project', snapshotId: 'snapshot', timelineDigest: 'digest',
      expectedContentRevision: request.contentRevision, persistedUpdatedAt: 'now', status: 'persisted', diskMatches: true, uiApplied: true, errorCode: null }) });
    const input = { conversationId: 'a', text: 'read saved', modelId: 'qwen2.5-coder', interactionMode: 'self-window' as const, hasUnsavedTimeline: false };
    expect((await session.sendMessage(input)).errorCode).toBe('CUA_EXPLICIT_SAVE_REQUIRED');
    expect(reads).toBe(0);
    await f.orchestrator.observe('a');
    expect(f.orchestrator.getLastActionResult('a')).toBeNull();
    expect((await session.sendMessage(input)).errorCode).toBe('CUA_EXPLICIT_SAVE_REQUIRED');
    expect(reads).toBe(0); // A new observation/run is not a Save of prior edits.
    saveToken = 'new-confirmed-save';
    await session.sendMessage(input);
    expect(reads).toBe(1);
  });

});
