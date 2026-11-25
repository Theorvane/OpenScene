import type {
  CuaAction,
  CuaActionSettlementAck,
  CuaActionSettlementTag,
  CuaPostInputState,
  CuaState
} from '../../../shared/cua';

export interface ActiveCuaSettlementTracker {
  readonly tag: CuaActionSettlementTag;
  readonly actionKind: CuaAction['kind'];
  stage: CuaPostInputState['stage'];
  readonly baseContentRevision: number;
  readonly baseContentFingerprint: string | null;
  /**
   * Present ONLY after a matching real renderer DOM handler (`drag`, `click`,
   * or `key`) explicitly completes without taint. Never fabricated by a timer
   * or default noop.
   */
  attribution: {
    readonly expectCommit: boolean;
    readonly expectedContentFingerprint: string | null;
  } | null;
  /**
   * Permanently latched to `true` if ANY unattributed, out-of-scope, external,
   * second, or mismatched timeline mutation occurs before settlement is
   * consumed. Once tainted, this action's settlement token is permanently dead.
   */
  tainted: boolean;
  /** One-shot consumption flag: once tagged snapshot+ack begins, never replay. */
  consumed: boolean;
}

export interface ReadyCuaActionSettlement {
  readonly tag: CuaActionSettlementTag;
  readonly outcome: CuaActionSettlementAck['outcome'];
  readonly baseContentRevision: number;
}

type SettlementListener = () => void;

const STAGE_ORDER: Readonly<Record<CuaPostInputState['stage'], number>> = {
  prepared: 0,
  armed: 1,
  released: 2
};

function tagsMatch(a: CuaActionSettlementTag, b: CuaActionSettlementTag): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.runId === b.runId &&
    a.windowId === b.windowId &&
    a.actionId === b.actionId &&
    a.generation === b.generation &&
    a.settlementToken === b.settlementToken
  );
}

function toTag(postInput: CuaPostInputState): CuaActionSettlementTag {
  return {
    sessionId: postInput.sessionId,
    runId: postInput.runId,
    windowId: postInput.windowId,
    actionId: postInput.actionId,
    generation: postInput.generation,
    settlementToken: postInput.settlementToken
  };
}

/**
 * Pure per-action renderer settlement coordinator with two-layer causal
 * attribution defense against pre-ACK external mutation laundering:
 *
 * Layer 1 (Immediate Taint): Any timeline mutation scheduled outside an active
 * matching `runWithAttribution` / safe-click scope — or any second/external
 * mutation while a tracker is active — permanently latches `tainted = true`
 * and drops attribution so subsequent surface reports go out UNTAGGED.
 *
 * Layer 2 (Exact Document Identity & Single-Step Revision): An attributed
 * `committed` action matches ONLY when `currentRevision === baseRevision + 1`
 * AND `currentFingerprint === expectedContentFingerprint`; an attributed `noop`
 * matches ONLY when `currentRevision === baseRevision` AND
 * `currentFingerprint === baseContentFingerprint`. Any mismatch permanently
 * taints the tracker so batched external edits can never borrow the token.
 */
export class CuaActionSettlementCoordinator {
  private tracker: ActiveCuaSettlementTracker | null = null;
  private activeScopeDepth = 0;
  private activeScopeTracker: ActiveCuaSettlementTracker | null = null;
  private activeScopeSawMutation = false;
  private activeScopeExpectedFingerprint: string | null = null;
  private openClickScope: {
    readonly tag: CuaActionSettlementTag;
    sawMutation: boolean;
    expectedFingerprint: string | null;
  } | null = null;
  private readonly listeners = new Set<SettlementListener>();

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Settlement listeners must never break input handlers.
      }
    });
  }

  private taintActiveTracker(): void {
    if (this.tracker === null || this.tracker.consumed) return;
    const changed = !this.tracker.tainted || this.tracker.attribution !== null;
    this.tracker.tainted = true;
    this.tracker.attribution = null;
    this.openClickScope = null;
    this.activeScopeTracker = null;
    if (changed) this.notify();
  }

  subscribe(listener: SettlementListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getTracker(): Readonly<ActiveCuaSettlementTracker> | null {
    return this.tracker;
  }

  clear(): void {
    const hadTracker = this.tracker !== null;
    this.tracker = null;
    this.openClickScope = null;
    this.activeScopeDepth = 0;
    this.activeScopeTracker = null;
    this.activeScopeSawMutation = false;
    this.activeScopeExpectedFingerprint = null;
    if (hadTracker) this.notify();
  }

  /**
   * Synchronizes tracker registration and stage progression from main-process
   * `CuaState`. Must be called synchronously inside `onCuaStateChanged` BEFORE
   * `cuaAckPrepare` is sent and whenever `postInput` advances.
   */
  syncFromCuaState(
    state: CuaState,
    currentContentRevision: number,
    currentContentFingerprint: string | null = null
  ): void {
    if (
      state.phase === 'idle' ||
      state.phase === 'stopping' ||
      state.phase === 'stopped' ||
      state.phase === 'cleanup-failed' ||
      state.postInput === undefined ||
      state.postInput === null
    ) {
      if (this.tracker !== null) {
        this.clear();
      }
      return;
    }

    const nextTag = toTag(state.postInput);
    const current = this.tracker;
    if (current !== null && tagsMatch(current.tag, nextTag)) {
      if (STAGE_ORDER[state.postInput.stage] > STAGE_ORDER[current.stage]) {
        current.stage = state.postInput.stage;
        this.notify();
      }
      return;
    }

    this.openClickScope = null;
    this.activeScopeTracker = null;
    this.tracker = {
      tag: nextTag,
      actionKind: state.postInput.actionKind,
      stage: state.postInput.stage,
      baseContentRevision: currentContentRevision,
      baseContentFingerprint: currentContentFingerprint,
      attribution: null,
      tainted: false,
      consumed: false
    };
    this.notify();
  }

  /**
   * Called synchronously by timeline mutation functions (`replaceTimeline`,
   * `undoTimeline`, `redoTimeline`) ONLY when the committed timeline fingerprint
   * actually changed and a React state update was scheduled.
   *
   * Layer 1: If called outside an active non-tainted matching attribution scope
   * (including before `runWithAttribution`, after `runWithAttribution` already
   * finished, or on any external edit), immediately taints the active tracker
   * so no subsequent report can ever carry the CUA settlement token.
   */
  notifyTimelineMutationScheduled(expectedFingerprint?: string): void {
    const tracker = this.tracker;
    if (tracker === null || tracker.consumed) return;
    if (tracker.tainted) return;

    const inMatchingRunScope =
      this.activeScopeDepth > 0 &&
      this.activeScopeTracker === tracker &&
      tracker.attribution === null;
    const inMatchingClickScope =
      this.openClickScope !== null &&
      tagsMatch(this.openClickScope.tag, tracker.tag) &&
      tracker.attribution === null;

    if (!inMatchingRunScope && !inMatchingClickScope) {
      this.taintActiveTracker();
      return;
    }

    if (inMatchingRunScope) {
      if (this.activeScopeSawMutation) {
        // A second distinct mutation even inside the scope cannot be causally
        // attributed as a single clean step — fail closed by tainting.
        this.taintActiveTracker();
        return;
      }
      this.activeScopeSawMutation = true;
      this.activeScopeExpectedFingerprint = expectedFingerprint ?? null;
      return;
    }

    if (this.openClickScope !== null) {
      if (this.openClickScope.sawMutation) {
        this.taintActiveTracker();
        return;
      }
      this.openClickScope.sawMutation = true;
      this.openClickScope.expectedFingerprint = expectedFingerprint ?? null;
    }
  }

  /**
   * Explicit Layer 1 taint hook for external project reloads, IPC project
   * updates, asset imports, or metadata replacements occurring while a
   * settlement tracker is active.
   */
  notifyExternalTimelineMutation(): void {
    this.taintActiveTracker();
  }

  /**
   * Runs a real renderer DOM action handler (`drag` or `key`) inside a
   * synchronous mutation-tracking scope. Records attribution ONLY if an
   * unconsumed, untainted tracker matching `actionKind` is active and has not
   * already been attributed.
   */
  runWithAttribution<T>(actionKind: CuaAction['kind'], fn: () => T): T {
    const tracker = this.tracker;
    if (
      tracker === null ||
      tracker.consumed ||
      tracker.tainted ||
      tracker.actionKind !== actionKind ||
      tracker.attribution !== null
    ) {
      return fn();
    }

    const isOuter = this.activeScopeDepth === 0;
    this.activeScopeDepth += 1;
    if (isOuter) {
      this.activeScopeTracker = tracker;
      this.activeScopeSawMutation = false;
      this.activeScopeExpectedFingerprint = null;
    }

    let threw = false;
    try {
      return fn();
    } catch (error) {
      threw = true;
      throw error;
    } finally {
      this.activeScopeDepth = Math.max(0, this.activeScopeDepth - 1);
      if (isOuter) {
        const sawMutation = this.activeScopeSawMutation;
        const expectedFingerprint = this.activeScopeExpectedFingerprint;
        this.activeScopeTracker = null;
        this.activeScopeSawMutation = false;
        this.activeScopeExpectedFingerprint = null;
        if (!threw && this.tracker === tracker && !tracker.consumed && !tracker.tainted && tracker.attribution === null) {
          tracker.attribution = {
            expectCommit: sawMutation,
            expectedContentFingerprint: sawMutation ? expectedFingerprint : tracker.baseContentFingerprint
          };
          this.notify();
        }
      }
    }
  }

  /**
   * Opens a safe-surface `click` attribution scope on capture phase so any
   * target button/clip/toolbar `onClick` handler running during target/bubble
   * phase can record whether it scheduled a timeline content mutation.
   */
  beginClickAttribution(): boolean {
    const tracker = this.tracker;
    if (
      tracker === null ||
      tracker.consumed ||
      tracker.tainted ||
      tracker.actionKind !== 'click' ||
      tracker.attribution !== null
    ) {
      return false;
    }
    this.openClickScope = { tag: tracker.tag, sawMutation: false, expectedFingerprint: null };
    return true;
  }

  /**
   * Closes an open safe-surface `click` attribution scope (called on bubble
   * phase or microtask fallback if a child called `stopPropagation()`).
   */
  completeClickAttribution(): boolean {
    const scope = this.openClickScope;
    if (scope === null) return false;
    this.openClickScope = null;
    const tracker = this.tracker;
    if (
      tracker === null ||
      tracker.consumed ||
      tracker.tainted ||
      tracker.attribution !== null ||
      !tagsMatch(tracker.tag, scope.tag)
    ) {
      return false;
    }
    tracker.attribution = {
      expectCommit: scope.sawMutation,
      expectedContentFingerprint: scope.sawMutation ? scope.expectedFingerprint : tracker.baseContentFingerprint
    };
    this.notify();
    return true;
  }

  private verifyCausalMatchOrTaint(
    tracker: ActiveCuaSettlementTracker,
    currentContentRevision: number,
    currentContentFingerprint?: string | null
  ): 'match' | 'waiting' | 'mismatch' {
    if (tracker.tainted || tracker.consumed || tracker.attribution === null) {
      return 'mismatch';
    }

    const { expectCommit, expectedContentFingerprint } = tracker.attribution;
    if (expectCommit) {
      if (currentContentRevision === tracker.baseContentRevision) {
        if (
          currentContentFingerprint !== undefined &&
          currentContentFingerprint !== null &&
          tracker.baseContentFingerprint !== null &&
          currentContentFingerprint !== tracker.baseContentFingerprint
        ) {
          this.taintActiveTracker();
          return 'mismatch';
        }
        return 'waiting';
      }
      // Strict single-step revision check: base + 1 ONLY (e.g. base=1 -> rev=3 taints!).
      if (currentContentRevision !== tracker.baseContentRevision + 1) {
        this.taintActiveTracker();
        return 'mismatch';
      }
      // Exact document identity check: catches same-React-commit batching of an
      // attributed CUA edit + an external edit where rev bumped 1 -> 2 only once.
      if (
        expectedContentFingerprint !== null &&
        currentContentFingerprint !== undefined &&
        currentContentFingerprint !== null &&
        currentContentFingerprint !== expectedContentFingerprint
      ) {
        this.taintActiveTracker();
        return 'mismatch';
      }
      return 'match';
    }

    // expectCommit === false (noop): revision AND fingerprint MUST be unchanged.
    if (currentContentRevision !== tracker.baseContentRevision) {
      this.taintActiveTracker();
      return 'mismatch';
    }
    if (
      tracker.baseContentFingerprint !== null &&
      currentContentFingerprint !== undefined &&
      currentContentFingerprint !== null &&
      currentContentFingerprint !== tracker.baseContentFingerprint
    ) {
      this.taintActiveTracker();
      return 'mismatch';
    }
    return 'match';
  }

  /**
   * Returns true ONLY when a clean, untainted, unconsumed attributed commit in
   * `armed` or `released` stage has already committed its exact single-step
   * `contentRevision` (`base + 1`) and `contentFingerprint` (`expectedContentFingerprint`)
   * and is awaiting `useLayoutEffect`'s `takeReadySettlement` consumption.
   *
   * This prevents stray `MutationObserver`/`rAF` `flushSnapshot()` calls from
   * leaking an untagged `crev = base + 1` report between `syncFromCuaState(stage='released')`
   * and `useLayoutEffect` consumption.
   *
   * Any pre-input (`prepared`), consumed, tainted, unattributed, multi-step
   * (`rev !== base + 1`), or fingerprint-mismatched change returns `false` so
   * it flushes UNTAGGED immediately and `CuaDriver` cancels with `content-changed`.
   */
  shouldDeferAttributedContentReport(
    currentContentRevision: number,
    currentContentFingerprint?: string | null
  ): boolean {
    const tracker = this.tracker;
    if (tracker === null || tracker.consumed || tracker.tainted || tracker.attribution === null) return false;
    if (tracker.stage !== 'armed' && tracker.stage !== 'released') return false;
    if (!tracker.attribution.expectCommit) return false;
    return this.verifyCausalMatchOrTaint(tracker, currentContentRevision, currentContentFingerprint) === 'match';
  }

  /**
   * Inspects whether the active tracker is ready to emit its single tagged
   * `cuaReportSurfaceSnapshot(snapshot, tag)` + `cuaAckActionSettlement(ack)`
   * sequence. Returns `null` if:
   * - no active unconsumed, untainted tracker exists,
   * - `stage !== 'released'` (main rejects pre-release ACKs),
   * - no matching real DOM handler ran (`attribution === null`), or
   * - revision/fingerprint does not strictly match the single attributed action
   *   (in which case the tracker is permanently tainted).
   *
   * Marks the tracker consumed immediately so it can NEVER replay.
   */
  takeReadySettlement(
    currentContentRevision: number,
    currentContentFingerprint?: string | null
  ): ReadyCuaActionSettlement | null {
    const tracker = this.tracker;
    if (tracker === null || tracker.consumed || tracker.tainted) return null;
    if (tracker.stage === 'prepared') return null;
    if (tracker.attribution === null) return null;

    const status = this.verifyCausalMatchOrTaint(tracker, currentContentRevision, currentContentFingerprint);
    if (status !== 'match') return null;
    if (tracker.stage !== 'released') return null;

    tracker.consumed = true;
    return {
      tag: tracker.tag,
      outcome: tracker.attribution.expectCommit ? 'committed' : 'noop',
      baseContentRevision: tracker.baseContentRevision
    };
  }
}

const defaultCoordinator = new CuaActionSettlementCoordinator();

export function syncCuaActionSettlementFromState(
  state: CuaState,
  currentContentRevision: number,
  currentContentFingerprint: string | null = null
): void {
  defaultCoordinator.syncFromCuaState(state, currentContentRevision, currentContentFingerprint);
}

export function clearCuaActionSettlement(): void {
  defaultCoordinator.clear();
}

export function notifyCuaTimelineMutationScheduled(expectedFingerprint?: string): void {
  defaultCoordinator.notifyTimelineMutationScheduled(expectedFingerprint);
}

export function notifyExternalCuaTimelineMutation(): void {
  defaultCoordinator.notifyExternalTimelineMutation();
}

export function runWithCuaActionAttribution<T>(actionKind: CuaAction['kind'], fn: () => T): T {
  return defaultCoordinator.runWithAttribution(actionKind, fn);
}

export function beginCuaSafeClickAttribution(): boolean {
  return defaultCoordinator.beginClickAttribution();
}

export function completeCuaSafeClickAttribution(): boolean {
  return defaultCoordinator.completeClickAttribution();
}

export function shouldDeferAttributedCuaContentReport(
  currentContentRevision: number,
  currentContentFingerprint?: string | null
): boolean {
  return defaultCoordinator.shouldDeferAttributedContentReport(currentContentRevision, currentContentFingerprint);
}

export function takeReadyCuaActionSettlement(
  currentContentRevision: number,
  currentContentFingerprint?: string | null
): ReadyCuaActionSettlement | null {
  return defaultCoordinator.takeReadySettlement(currentContentRevision, currentContentFingerprint);
}

export function subscribeCuaActionSettlement(listener: SettlementListener): () => void {
  return defaultCoordinator.subscribe(listener);
}

export function getActiveCuaActionSettlementForTests(): Readonly<ActiveCuaSettlementTracker> | null {
  return defaultCoordinator.getTracker();
}

export function resetCuaActionSettlementForTests(): void {
  defaultCoordinator.clear();
}
