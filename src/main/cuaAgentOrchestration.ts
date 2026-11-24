import { createHash, randomUUID } from 'node:crypto';
import type { CuaActionRequest, CuaFrame, CuaState } from '../shared/cua';
import type { AgentCuaApprovalSummary, AgentCuaErrorCode } from '../shared/agentChat';

export class CuaApprovalError extends Error {
  constructor(readonly code: AgentCuaErrorCode) { super(code); }
}

interface Proposal {
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly request: CuaActionRequest;
  readonly digest: string;
}
interface Permit extends Proposal { readonly issuedAt: number }

function digest(request: CuaActionRequest): string {
  // Copy only the canonical contract fields. Caller property ordering and extra
  // model-generated properties cannot change what was approved.
  const action = request.action;
  const canonicalAction = action.kind === 'click'
    ? ['click', action.point.x, action.point.y]
    : action.kind === 'drag'
      ? ['drag', action.from.x, action.from.y, action.to.x, action.to.y, action.durationMs]
      : ['key', action.key, [...action.modifiers].sort()];
  return createHash('sha256').update(JSON.stringify([
    request.sessionId, request.runId, request.windowId, request.frameId,
    request.layoutRevision, request.contentRevision, canonicalAction
  ])).digest('hex');
}

/**
 * Main-only authority. Neither a tool argument nor renderer approval carries
 * this object. Driver validation must finish before calling consume, with no
 * await between consumption and input dispatch. TTL and budget are supplied by
 * trusted wiring, not by the model; the driver independently checks frame age.
 */
export class CuaApprovalAuthority {
  private pending: Proposal | null = null;
  private readonly permits = new Map<string, Permit>();
  private readonly seenCalls = new Set<string>();
  private readonly revokedRuns = new Set<string>();
  private readonly actionsByRun = new Map<string, number>();
  private cleanupFailed = false;

  constructor(private readonly options: {
    readonly permitTtlMs: number;
    readonly maxActionsPerRun: number;
    readonly now: () => number;
  }) {
    if (!Number.isFinite(options.permitTtlMs) || options.permitTtlMs <= 0 || options.permitTtlMs > 10_000
      || !Number.isSafeInteger(options.maxActionsPerRun) || options.maxActionsPerRun < 1 || options.maxActionsPerRun > 100) {
      throw new Error('Invalid trusted CUA authority limits');
    }
  }

  propose(conversationId: string, toolCallId: string, request: CuaActionRequest): void {
    this.checkRun(request.runId);
    if (this.pending !== null || this.permits.size > 0) throw new CuaApprovalError('CUA_BUSY');
    const callKey = JSON.stringify([conversationId, toolCallId]);
    if (this.seenCalls.has(callKey)) throw new CuaApprovalError('CUA_ACTION_REPLAYED');
    if ((this.actionsByRun.get(request.runId) ?? 0) >= this.options.maxActionsPerRun) {
      throw new CuaApprovalError('CUA_BUDGET_EXCEEDED');
    }
    this.seenCalls.add(callKey);
    // Approval evidence cannot be mutated while the human reads it.
    const snapshot = structuredClone(request);
    this.pending = { conversationId, toolCallId, request: snapshot, digest: digest(snapshot) };
  }

  issueApproved(conversationId: string, toolCallId: string, request: CuaActionRequest): unknown {
    this.checkRun(request.runId);
    const proposal = this.pending;
    if (proposal === null || proposal.conversationId !== conversationId
      || proposal.toolCallId !== toolCallId || proposal.digest !== digest(request)) {
      throw new CuaApprovalError('CUA_APPROVAL_MISMATCH');
    }
    const token = randomUUID();
    this.permits.set(token, { ...proposal, issuedAt: this.options.now() });
    this.pending = null;
    return token;
  }

  deny(conversationId: string, toolCallId: string): void {
    if (this.pending?.conversationId !== conversationId || this.pending.toolCallId !== toolCallId) {
      throw new CuaApprovalError('CUA_APPROVAL_MISMATCH');
    }
    this.pending = null;
  }

  getPendingApproval(): Readonly<{
    conversationId: string; toolCallId: string; sessionId: string; runId: string;
    windowId: number; frameId: string; layoutRevision: number; contentRevision: number;
  }> | null {
    const pending = this.pending;
    if (!pending) return null;
    const { sessionId, runId, windowId, frameId, layoutRevision, contentRevision } = pending.request;
    return Object.freeze({ conversationId: pending.conversationId, toolCallId: pending.toolCallId,
      sessionId, runId, windowId, frameId, layoutRevision, contentRevision });
  }

  /** Non-consuming preflight. It never extends time or changes approved scope. */
  check(request: CuaActionRequest, token: unknown): void {
    this.checkRun(request.runId);
    if (this.pending !== null) throw new CuaApprovalError('CUA_BUSY');
    const permit = typeof token === 'string' ? this.permits.get(token) : undefined;
    if (permit === undefined) throw new CuaApprovalError('CUA_ACTION_REPLAYED');
    if (permit.digest !== digest(request)) throw new CuaApprovalError('CUA_APPROVAL_MISMATCH');
    const elapsed = this.options.now() - permit.issuedAt;
    if (elapsed < 0 || elapsed >= this.options.permitTtlMs) throw new CuaApprovalError('CUA_APPROVAL_EXPIRED');
    const count = this.actionsByRun.get(request.runId) ?? 0;
    if (count >= this.options.maxActionsPerRun) throw new CuaApprovalError('CUA_BUDGET_EXCEEDED');
  }

  /** Synchronous, atomic and one-use, including attempts with wrong evidence. */
  consume(request: CuaActionRequest, token: unknown): void {
    try { this.check(request, token); }
    finally { if (typeof token === 'string') this.permits.delete(token); }
    this.actionsByRun.set(request.runId, (this.actionsByRun.get(request.runId) ?? 0) + 1);
  }

  /** Called synchronously on every cancellation source before releasing input. */
  revokeRun(runId: string): void {
    this.revokedRuns.add(runId);
    if (this.pending?.request.runId === runId) this.pending = null;
    for (const [token, permit] of this.permits) {
      if (permit.request.runId === runId) this.permits.delete(token);
    }
  }

  /** A failed release requires explicit app/driver recovery, never a new run. */
  recordCleanupFailure(): void {
    this.cleanupFailed = true;
    this.pending = null;
    this.permits.clear();
  }

  assertRunAllowed(runId: string): void { this.checkRun(runId); }

  private checkRun(runId: string): void {
    if (this.cleanupFailed) throw new CuaApprovalError('CUA_CLEANUP_FAILED');
    if (this.revokedRuns.has(runId)) throw new CuaApprovalError('CUA_CANCELLED');
  }
}

/** Structural seam implemented by the independently owned self-window driver. */
export interface CuaAgentDriver {
  observe(scope: { sessionId: string; runId: string }): Promise<CuaFrame>;
  execute(request: CuaActionRequest, permit: unknown, signal?: AbortSignal): Promise<CuaState>;
  cancel(reason?: string): Promise<CuaState>;
  getState(): CuaState;
  setExecutionBlocked(blocked: boolean): void;
}

interface BoundRun {
  readonly conversationId: string;
  readonly runId: string;
  readonly controller: AbortController;
  frame: CuaFrame | null;
  observation: Promise<CuaFrame> | null;
  pending: { readonly toolCallId: string; readonly request: CuaActionRequest } | null;
}

/** Trusted main wiring owns this instance and the immutable run bindings. */
export class CuaAgentOrchestrator {
  private readonly sessionId = randomUUID();
  private readonly runs = new Map<string, BoundRun>();
  private readonly byConversation = new Map<string, BoundRun>();
  private readonly cancellations = new Map<string, Promise<void>>();

  constructor(readonly authority: CuaApprovalAuthority, private readonly options: {
    readonly driver: CuaAgentDriver;
    readonly onAbortConversation: (conversationId: string) => void;
  }) {}

  async observe(conversationId: string): Promise<{ success: true; summary: string; frame: CuaFrame }> {
    let run = this.byConversation.get(conversationId);
    if (run?.controller.signal.aborted) throw new CuaApprovalError('CUA_CANCELLED');
    if (!run) {
      if (this.byConversation.size > 0) throw new CuaApprovalError('CUA_BUSY');
      run = { conversationId, runId: randomUUID(), controller: new AbortController(), frame: null, observation: null, pending: null };
      this.byConversation.set(conversationId, run);
      this.runs.set(run.runId, run);
    }
    if (run.pending) throw new CuaApprovalError('CUA_BUSY');
    this.authority.assertRunAllowed(run.runId);
    if (run.observation) throw new CuaApprovalError('CUA_BUSY');
    run.observation = this.options.driver.observe({ sessionId: this.sessionId, runId: run.runId });
    let frame: CuaFrame;
    try { frame = await run.observation; }
    finally { run.observation = null; }
    run.controller.signal.throwIfAborted();
    if (frame.sessionId !== this.sessionId || frame.runId !== run.runId) throw new CuaApprovalError('CUA_SCOPE_CHANGED');
    run.frame = structuredClone(frame);
    return { success: true, summary: `Self-window observation frameId=${frame.frameId}, layoutRevision=${frame.layoutRevision}, contentRevision=${frame.contentRevision}; CSS viewport ${frame.viewport.width}×${frame.viewport.height}.`, frame };
  }

  prepareApproval(conversationId: string, toolCallId: string, request: CuaActionRequest): AgentCuaApprovalSummary {
    const run = this.requireRun(conversationId, request);
    const frame = run.frame;
    if (!frame || frame.frameId !== request.frameId || frame.layoutRevision !== request.layoutRevision
      || frame.contentRevision !== request.contentRevision) {
      throw new CuaApprovalError('CUA_FRAME_STALE');
    }
    this.options.driver.setExecutionBlocked(true);
    if (run.pending) {
      // LangGraph replays this node while resuming its interrupt.
      if (run.pending.toolCallId !== toolCallId || digest(run.pending.request) !== digest(request)) {
        throw new CuaApprovalError('CUA_APPROVAL_MISMATCH');
      }
    } else {
      this.authority.propose(conversationId, toolCallId, request);
      run.pending = { toolCallId, request: structuredClone(request) };
    }
    const action = request.action;
    return { actionKind: action.kind, actionLabel: action.kind === 'key' ? `Press ${action.modifiers.join('+')}${action.modifiers.length ? '+' : ''}${action.key}` : action.kind === 'drag' ? `Drag for ${action.durationMs} ms` : 'Click',
      frameId: request.frameId, scopeRevision: request.layoutRevision, contentRevision: request.contentRevision, coordinateSpace: 'css',
      ...(action.kind === 'click' ? { coords: action.point } : action.kind === 'drag' ? { coords: action.from, dragTo: action.to } : {}) };
  }

  deny(conversationId: string, toolCallId: string): void {
    this.options.driver.setExecutionBlocked(true);
    this.authority.deny(conversationId, toolCallId);
    const run = this.byConversation.get(conversationId);
    if (run?.pending?.toolCallId === toolCallId) run.pending = null;
  }

  async executeApproved(conversationId: string, toolCallId: string, request: CuaActionRequest): Promise<unknown> {
    const run = this.requireRun(conversationId, request);
    try {
      const permit = this.authority.issueApproved(conversationId, toolCallId, request);
      run.pending = null;
      this.options.driver.setExecutionBlocked(false);
      const state = await this.options.driver.execute(request, permit, run.controller.signal);
      if (!state.cleanupComplete || state.phase === 'cleanup-failed') {
        this.authority.recordCleanupFailure();
        throw new CuaApprovalError('CUA_CLEANUP_FAILED');
      }
      run.frame = null;
      // Input has settled successfully. A later observation can race a real
      // committed-content report, so it is a separate tool step and cannot
      // turn this successful action into an apparent failure/retry.
      return { success: true, actionExecuted: true, observationRequired: true, state,
        summary: 'The approved input executed and released successfully. Its original frame is consumed. Call observeEditorWindow alone for new evidence before another action; observation failure must not retry this input.' };
    } catch (error) {
      await this.cancelConversation(conversationId);
      throw error;
    } finally {
      this.options.driver.setExecutionBlocked(true);
    }
  }

  /** Driver onCancel calls this; no driver methods and no recursive cancellation. */
  abortRun(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.authority.revokeRun(runId);
    if (run.controller.signal.aborted) return;
    run.controller.abort();
    this.options.onAbortConversation(run.conversationId);
  }

  /** Trusted driver onState only; a renderer state payload must never call this. */
  settleRun(state: CuaState): void {
    if (state.sessionId !== this.sessionId || !state.runId) return;
    const run = this.runs.get(state.runId);
    if (!run) return;
    if (state.phase === 'cleanup-failed' || (state.phase === 'stopped' && !state.cleanupComplete)) this.authority.recordCleanupFailure();
    if (state.phase !== 'stopped' && state.phase !== 'cleanup-failed') return;
    this.abortRun(run.runId);
    this.runs.delete(run.runId);
    if (this.byConversation.get(run.conversationId) === run) this.byConversation.delete(run.conversationId);
  }

  cancelConversation(conversationId: string): Promise<void> {
    const existing = this.cancellations.get(conversationId);
    if (existing) return existing;
    const run = this.byConversation.get(conversationId);
    if (!run) return Promise.resolve();
    this.abortRun(run.runId);
    const settlement = Promise.resolve().then(async () => {
      await run.observation?.catch(() => undefined);
      const state = this.options.driver.getState();
      // A stale cancellation never cancels another conversation or newer run.
      if (state.runId !== run.runId || state.sessionId !== this.sessionId) return;
      this.options.driver.setExecutionBlocked(true);
      const stopped = await this.options.driver.cancel('agent_cancelled');
      if (!stopped.cleanupComplete || stopped.phase === 'cleanup-failed') {
        this.authority.recordCleanupFailure();
        throw new CuaApprovalError('CUA_CLEANUP_FAILED');
      }
    }).finally(() => {
      this.runs.delete(run.runId);
      if (this.byConversation.get(conversationId) === run) this.byConversation.delete(conversationId);
      this.cancellations.delete(conversationId);
    });
    this.cancellations.set(conversationId, settlement);
    return settlement;
  }

  private requireRun(conversationId: string, request: CuaActionRequest): BoundRun {
    const run = this.byConversation.get(conversationId);
    if (!run || run.runId !== request.runId || this.sessionId !== request.sessionId
      || run.frame?.windowId !== request.windowId) throw new CuaApprovalError('CUA_SCOPE_CHANGED');
    run.controller.signal.throwIfAborted();
    return run;
  }
}
