import { describe, expect, it } from 'vitest';
import { CuaAgentOrchestrator, CuaApprovalAuthority, type CuaAgentDriver } from '../src/main/cuaAgentOrchestration';
import type { CuaActionRequest, CuaFrame, CuaState } from '../src/shared/cua';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { buildAgentChatGraph, isToolMessage } from '../src/main/agentChatGraph';
import { createCuaAgentChatTools, AGENT_CHAT_CUA_PER_CALL_TOOL_NAMES } from '../src/main/agentChatTools';
import { AgentChatSessionManager } from '../src/main/agentChatSession';

function fixture() {
  let state: CuaState = { prepareToken: null, sessionId: null, runId: null, windowId: 7, phase: 'idle', cursor: null,
    dragStart: null, target: null, label: null, error: null, cleanupComplete: true, releaseFailures: [], cancelToken: null, targetGone: false };
  let frameNumber = 0;
  let inputs = 0;
  let cancellations = 0;
  let blocked = true;
  const aborted: string[] = [];
  const authority = new CuaApprovalAuthority({ permitTtlMs: 100, maxActionsPerRun: 2, now: () => 0 });
  const driver: CuaAgentDriver = {
    observe: async (scope) => {
      state = { ...state, ...scope, phase: 'ready' };
      return { ...scope, contentRevision: 0, windowId: 7, frameId: `frame-${++frameNumber}`, layoutRevision: 1, capturedAt: 0,
        viewport: { width: 100, height: 100 }, bitmap: { width: 100, height: 100 }, deviceScaleFactor: 1,
        zoomFactor: 1, pngDataUrl: 'data:image/png;base64,AAAA' };
    },
    execute: async (request, permit) => {
      expect(blocked).toBe(false);
      authority.consume(request, permit);
      inputs++;
      return state;
    },
    getState: () => state,
    cancel: async () => { cancellations++; state = { ...state, phase: 'stopped' }; return state; },
    setExecutionBlocked: (value) => { blocked = value; }
  };
  const orchestrator = new CuaAgentOrchestrator(authority, { driver, onAbortConversation: (id) => { aborted.push(id); } });
  const requestFor = (frame: CuaFrame): CuaActionRequest => ({ sessionId: frame.sessionId, runId: frame.runId,
    contentRevision: frame.contentRevision, windowId: frame.windowId, frameId: frame.frameId, layoutRevision: frame.layoutRevision, action: { kind: 'click', point: { x: 10, y: 20 } } });
  return { authority, driver, orchestrator, aborted, requestFor, inputs: () => inputs,
    cancellations: () => cancellations, blocked: () => blocked };
}

describe('CUA immutable run binding and dispatch', () => {
  it('reports observation only after driver promise assignment and clears it on settlement', async () => {
    const f = fixture();
    const originalObserve = f.driver.observe;
    let scope!: { sessionId: string; runId: string };
    let entered!: () => void;
    let release!: () => void;
    const enteredDriver = new Promise<void>((resolve) => { entered = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    f.driver.observe = async (context) => {
      scope = context;
      expect(f.orchestrator.isObservationInFlight(context)).toBe(false);
      await Promise.resolve();
      expect(f.orchestrator.isObservationInFlight(context)).toBe(true);
      entered();
      await released;
      return originalObserve(context);
    };
    const observation = f.orchestrator.observe('a');
    await enteredDriver;
    expect(f.orchestrator.isObservationInFlight(scope)).toBe(true);
    expect(f.orchestrator.isObservationInFlight({ ...scope, sessionId: 'other' })).toBe(false);
    expect(f.orchestrator.isObservationInFlight({ ...scope, runId: 'other' })).toBe(false);
    release();
    await observation;
    expect(f.orchestrator.isObservationInFlight(scope)).toBe(false);
  });

  it('does not leave observation in flight after a synchronous driver throw', async () => {
    const f = fixture();
    let scope!: { sessionId: string; runId: string };
    f.driver.observe = (context) => { scope = context; throw new Error('capture refused'); };
    await expect(f.orchestrator.observe('a')).rejects.toThrow('capture refused');
    expect(f.orchestrator.isObservationInFlight(scope)).toBe(false);
  });

  it('clears the read-only observation flag when the driver promise rejects', async () => {
    const f = fixture();
    let scope!: { sessionId: string; runId: string };
    f.driver.observe = async (context) => { scope = context; throw new Error('capture failed'); };
    const observation = f.orchestrator.observe('a');
    expect(f.orchestrator.isObservationInFlight(scope)).toBe(true);
    await expect(observation).rejects.toThrow('capture failed');
    expect(f.orchestrator.isObservationInFlight(scope)).toBe(false);
  });

  it('stops reporting an in-flight observation synchronously when its run is aborted', async () => {
    const f = fixture();
    const originalObserve = f.driver.observe;
    let scope!: { sessionId: string; runId: string };
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    f.driver.observe = async (context) => { scope = context; await released; return originalObserve(context); };
    const observation = f.orchestrator.observe('a');
    expect(f.orchestrator.isObservationInFlight(scope)).toBe(true);
    const stop = f.orchestrator.cancelConversation('a');
    expect(f.orchestrator.isObservationInFlight(scope)).toBe(false);
    const rejected = expect(observation).rejects.toThrow();
    release();
    await Promise.all([rejected, stop]);
    expect(f.orchestrator.isObservationInFlight(scope)).toBe(false);
  });

  it('cannot bypass graph approval by invoking the action tool directly', async () => {
    const f = fixture();
    const request = f.requestFor((await f.orchestrator.observe('a')).frame);
    const action = createCuaAgentChatTools(f.orchestrator).find((candidate) => candidate.name === 'executeCuaAction')!;
    await expect(action.invoke(request)).rejects.toThrow('CUA_APPROVAL_MISMATCH');
    expect(f.inputs()).toBe(0);
  });

  it('carries PNG evidence to a synthetic model, displays exact approval, then reobserves without transcript base64', async () => {
    const f = fixture();
    let step = 0;
    let seen: BaseMessage[] = [];
    const bundle = buildAgentChatGraph({ tools: createCuaAgentChatTools(f.orchestrator), cua: f.orchestrator,
      mutatingToolNames: new Set(['executeCuaAction']), perCallApprovalToolNames: AGENT_CHAT_CUA_PER_CALL_TOOL_NAMES,
      createModel: () => ({ invoke: async (messages) => {
        seen = messages;
        if (step++ === 0) return new AIMessage({ content: '', tool_calls: [{ id: 'observe', name: 'observeEditorWindow', args: {} }] });
        if (step === 2) {
          const observation = messages.find((message) => isToolMessage(message) && message.name === 'observeEditorWindow');
          const metadata = JSON.parse(String(observation!.content).split('\n').at(-1)!) as CuaFrame;
          return new AIMessage({ content: '', tool_calls: [{ id: 'action', name: 'executeCuaAction', args: { ...f.requestFor(metadata) } }] });
        }
        if (step === 3) return new AIMessage({ content: '', tool_calls: [{ id: 'observe-after-action', name: 'observeEditorWindow', args: {} }] });
        return new AIMessage('Action observed; inspect project timeline next.');
      } })
    });
    const session = new AgentChatSessionManager(bundle, { cancelCua: (id) => f.orchestrator.cancelConversation(id) });
    const pending = await session.sendMessage({ conversationId: 'a', text: 'click', modelId: 'qwen2.5-coder' });
    expect(pending.pendingApproval?.cuaApproval?.frameId).toBe('frame-1');
    expect(pending.pendingApproval?.cuaApproval?.coords).toEqual({ x: 10, y: 20 });
    expect(f.inputs()).toBe(0);
    const done = await session.respondToApproval({ conversationId: 'a', toolCallId: 'action', decision: 'approve' });
    expect(done.status).toBe('idle');
    expect(f.inputs()).toBe(1);
    expect(done.messages.some((message) => message.text.includes('base64'))).toBe(false);
    expect(seen.some((message) => Array.isArray(message.content) && message.content.some((block) => block.type === 'image_url'))).toBe(true);
    expect(done.messages.some((message) => message.text.includes('frame-2'))).toBe(true);
  });

  it('preserves the original frame through prompt replay and runs the approved action once', async () => {
    const f = fixture();
    const observed = await f.orchestrator.observe('a');
    const request = f.requestFor(observed.frame);
    const summary = f.orchestrator.prepareApproval('a', 'one', request);
    expect(f.orchestrator.prepareApproval('a', 'one', request)).toEqual(summary);
    expect(f.authority.getPendingApproval()?.runId).toBe(observed.frame.runId);
    const executed = await f.orchestrator.executeApproved('a', 'one', request);
    expect(executed).toMatchObject({ success: true, actionExecuted: true, observationRequired: true });
    expect(f.inputs()).toBe(1);
    expect(f.blocked()).toBe(true);
    await expect(f.orchestrator.executeApproved('a', 'one', request)).rejects.toThrow();
    expect(f.inputs()).toBe(1);
  });

  it('does not recapture or retry successful input when a later explicit observation fails', async () => {
    const f = fixture();
    const request = f.requestFor((await f.orchestrator.observe('a')).frame);
    f.orchestrator.prepareApproval('a', 'one', request);
    f.driver.observe = async () => { throw new Error('CUA_STALE_FRAME'); };
    const executed = await f.orchestrator.executeApproved('a', 'one', request);
    expect(executed).toMatchObject({ success: true, actionExecuted: true });
    expect(f.inputs()).toBe(1);
    await expect(f.orchestrator.observe('a')).rejects.toThrow('CUA_STALE_FRAME');
    expect(f.inputs()).toBe(1);
    expect(f.cancellations()).toBe(0);
    expect(() => f.orchestrator.prepareApproval('a', 'new-action', request)).toThrow();
  });

  it('refuses a newly observed frame to inherit an old approval', async () => {
    const f = fixture();
    const first = await f.orchestrator.observe('a');
    const second = await f.orchestrator.observe('a');
    expect(second.frame.frameId).not.toBe(first.frame.frameId);
    expect(() => f.orchestrator.prepareApproval('a', 'one', f.requestFor(first.frame))).toThrow('CUA_FRAME_STALE');
    expect(f.inputs()).toBe(0);
  });

  it('rejects an altered content revision even when frame and layout IDs match', async () => {
    const f = fixture();
    const request = f.requestFor((await f.orchestrator.observe('a')).frame);
    expect(() => f.orchestrator.prepareApproval('a', 'one', { ...request, contentRevision: request.contentRevision + 1 })).toThrow('CUA_FRAME_STALE');
    expect(f.authority.getPendingApproval()).toBeNull();
    expect(f.inputs()).toBe(0);
  });

  it('cannot cancel the active run through another conversation ID', async () => {
    const f = fixture();
    await f.orchestrator.observe('a');
    await f.orchestrator.cancelConversation('b');
    expect(f.cancellations()).toBe(0);
    expect(f.aborted).toEqual([]);
  });

  it('shares cancellation settlement, revokes first and removes the old run binding', async () => {
    const f = fixture();
    const old = await f.orchestrator.observe('a');
    const request = f.requestFor(old.frame);
    f.orchestrator.prepareApproval('a', 'one', request);
    const cancelled = f.orchestrator.cancelConversation('a');
    expect(f.orchestrator.cancelConversation('a')).toBe(cancelled);
    expect(f.authority.getPendingApproval()).toBeNull();
    expect(f.aborted).toEqual(['a']);
    await cancelled;
    const next = await f.orchestrator.observe('b');
    expect(next.frame.runId).not.toBe(old.frame.runId);
    f.orchestrator.abortRun(old.frame.runId);
    expect(f.aborted).toEqual(['a']);
    f.orchestrator.prepareApproval('b', 'new', f.requestFor(next.frame));
  });

  it('settles a trusted external stop without keeping a dead conversation binding', async () => {
    const f = fixture();
    const old = await f.orchestrator.observe('a');
    f.orchestrator.abortRun(old.frame.runId);
    f.orchestrator.settleRun({ ...f.driver.getState(), phase: 'stopped' });
    const next = await f.orchestrator.observe('b');
    expect(next.frame.runId).not.toBe(old.frame.runId);
    f.orchestrator.abortRun(old.frame.runId);
    expect(f.aborted.every((id) => id === 'a')).toBe(true);
  });

  it('denial leaves main execution blocked and provides no permit', async () => {
    const f = fixture();
    const frame = (await f.orchestrator.observe('a')).frame;
    const request = f.requestFor(frame);
    f.orchestrator.prepareApproval('a', 'one', request);
    f.orchestrator.deny('a', 'one');
    expect(f.blocked()).toBe(true);
    await expect(f.orchestrator.executeApproved('a', 'one', request)).rejects.toThrow('CUA_APPROVAL_MISMATCH');
    expect(f.inputs()).toBe(0);
  });

  it('awaits the entire rollback/physical-release promise before cancellation completes', async () => {
    const f = fixture();
    await f.orchestrator.observe('a');
    let release!: () => void;
    let held = 1;
    let settled = false;
    const released = new Promise<void>((resolve) => { release = resolve; });
    f.driver.cancel = async () => {
      await released;
      held = 0;
      return { ...f.driver.getState(), phase: 'stopped', cleanupComplete: true };
    };
    const stop = f.orchestrator.cancelConversation('a');
    void stop.then(() => { settled = true; });
    expect(f.orchestrator.cancelConversation('a')).toBe(stop);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(held).toBe(1);
    release();
    await stop;
    expect(held).toBe(0);
    expect(settled).toBe(true);
  });

  it('latches failed rollback even when physical held input is zero', async () => {
    const f = fixture();
    await f.orchestrator.observe('a');
    f.driver.cancel = async () => ({ ...f.driver.getState(), phase: 'cleanup-failed', cleanupComplete: false,
      releaseFailures: ['renderer-rollback-unconfirmed'] });
    await expect(f.orchestrator.cancelConversation('a')).rejects.toThrow('CUA_CLEANUP_FAILED');
    await expect(f.orchestrator.observe('b')).rejects.toThrow('CUA_CLEANUP_FAILED');
  });
});
