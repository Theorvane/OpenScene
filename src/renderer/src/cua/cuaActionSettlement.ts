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
  /**
   * Present ONLY after a matching real renderer DOM handler (`drag`, `click`,
   * or `key`) explicitly completes for this action. Never fabricated by a
   * timer or default noop.
   */
  attribution: { readonly expectCommit: boolean } | null;
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
 * Pure per-action renderer settlement coordinator.
 *
 * Tracks a single active CUA `postInput` token from `prepared` -> `armed` ->
 * `released`, attributes completion STRICTLY from matching real DOM action
 * handlers (`drag`, `click`, `key`), and yields a one-shot settlement payload
 * only after React commits the expected `contentRevision`.
 */
export class CuaActionSettlementCoordinator {
  private tracker: ActiveCuaSettlementTracker | null = null;
  private activeScopeDepth = 0;
  private activeScopeSawMutation = false;
  private openClickScope: { readonly tag: CuaActionSettlementTag; sawMutation: boolean } | null = null;
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
    this.activeScopeSawMutation = false;
    if (hadTracker) this.notify();
  }

  /**
   * Synchronizes tracker registration and stage progression from main-process
   * `CuaState`. Must be called synchronously inside `onCuaStateChanged` BEFORE
   * `cuaAckPrepare` is sent and whenever `postInput` advances.
   */
  syncFromCuaState(state: CuaState, currentContentRevision: number): void {
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
    this.tracker = {
      tag: nextTag,
      actionKind: state.postInput.actionKind,
      stage: state.postInput.stage,
      baseContentRevision: currentContentRevision,
      attribution: null,
      consumed: false
    };
    this.notify();
  }

  /**
   * Called synchronously by timeline mutation functions (`replaceTimeline`,
   * `undoTimeline`, `redoTimeline`) ONLY when the committed timeline fingerprint
   * actually changed and a React state update was scheduled.
   */
  notifyTimelineMutationScheduled(): void {
    if (this.activeScopeDepth > 0) {
      this.activeScopeSawMutation = true;
    }
    if (this.openClickScope !== null) {
      this.openClickScope.sawMutation = true;
    }
  }

  /**
   * Runs a real renderer DOM action handler (`drag` or `key`) inside a
   * synchronous mutation-tracking scope. Records attribution ONLY if an
   * unconsumed tracker matching `actionKind` is active and has not already been
   * attributed.
   */
  runWithAttribution<T>(actionKind: CuaAction['kind'], fn: () => T): T {
    const tracker = this.tracker;
    if (tracker === null || tracker.consumed || tracker.actionKind !== actionKind || tracker.attribution !== null) {
      return fn();
    }

    const isOuter = this.activeScopeDepth === 0;
    this.activeScopeDepth += 1;
    if (isOuter) {
      this.activeScopeSawMutation = false;
    }

    let threw = false;
    try {
      return fn();
    } catch (error) {
      threw = true;
      throw error;
    } finally {
      this.activeScopeDepth = Math.max(0, this.activeScopeDepth - 1);
      if (isOuter && !threw) {
        const sawMutation = this.activeScopeSawMutation;
        this.activeScopeSawMutation = false;
        if (this.tracker === tracker && !tracker.consumed && tracker.attribution === null) {
          tracker.attribution = { expectCommit: sawMutation };
          this.notify();
        }
      } else if (isOuter) {
        this.activeScopeSawMutation = false;
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
    if (tracker === null || tracker.consumed || tracker.actionKind !== 'click' || tracker.attribution !== null) {
      return false;
    }
    this.openClickScope = { tag: tracker.tag, sawMutation: false };
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
    if (tracker === null || tracker.consumed || tracker.attribution !== null || !tagsMatch(tracker.tag, scope.tag)) {
      return false;
    }
    tracker.attribution = { expectCommit: scope.sawMutation };
    this.notify();
    return true;
  }

  /**
   * Returns true ONLY when an attributed action has already committed its new
   * `contentRevision` in React BEFORE main's `postInput.stage === 'released'`
   * IPC message has arrived. Used solely to avoid sending an untagged
   * `contentRevision` report for that already-attributed action during the
   * sub-millisecond window before `stage === 'released'` lands.
   *
   * Unattributed external changes (`attribution === null`) NEVER return true
   * here and always flush untagged immediately.
   */
  shouldDeferAttributedContentReport(currentContentRevision: number): boolean {
    const tracker = this.tracker;
    if (tracker === null || tracker.consumed || tracker.attribution === null) return false;
    if (tracker.stage === 'released') return false;
    return tracker.attribution.expectCommit && currentContentRevision > tracker.baseContentRevision;
  }

  /**
   * Inspects whether the active tracker is ready to emit its single tagged
   * `cuaReportSurfaceSnapshot(snapshot, tag)` + `cuaAckActionSettlement(ack)`
   * sequence. Returns `null` if:
   * - no active unconsumed tracker exists,
   * - `stage !== 'released'` (main rejects pre-release ACKs),
   * - no matching real DOM handler ran (`attribution === null`),
   * - `expectCommit === true` but React has not yet committed `contentRevision > baseContentRevision`, or
   * - `expectCommit === false` but `contentRevision !== baseContentRevision` (concurrent unattributed edit).
   *
   * Marks the tracker consumed immediately so it can NEVER replay.
   */
  takeReadySettlement(currentContentRevision: number): ReadyCuaActionSettlement | null {
    const tracker = this.tracker;
    if (tracker === null || tracker.consumed) return null;
    if (tracker.stage !== 'released') return null;
    if (tracker.attribution === null) return null;

    if (tracker.attribution.expectCommit) {
      if (currentContentRevision <= tracker.baseContentRevision) {
        return null;
      }
      tracker.consumed = true;
      return {
        tag: tracker.tag,
        outcome: 'committed',
        baseContentRevision: tracker.baseContentRevision
      };
    }

    if (currentContentRevision !== tracker.baseContentRevision) {
      // Unexpected unattributed content mutation: never misattribute it as noop.
      return null;
    }
    tracker.consumed = true;
    return {
      tag: tracker.tag,
      outcome: 'noop',
      baseContentRevision: tracker.baseContentRevision
    };
  }
}

const defaultCoordinator = new CuaActionSettlementCoordinator();

export function syncCuaActionSettlementFromState(state: CuaState, currentContentRevision: number): void {
  defaultCoordinator.syncFromCuaState(state, currentContentRevision);
}

export function clearCuaActionSettlement(): void {
  defaultCoordinator.clear();
}

export function notifyCuaTimelineMutationScheduled(): void {
  defaultCoordinator.notifyTimelineMutationScheduled();
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

export function shouldDeferAttributedCuaContentReport(currentContentRevision: number): boolean {
  return defaultCoordinator.shouldDeferAttributedContentReport(currentContentRevision);
}

export function takeReadyCuaActionSettlement(currentContentRevision: number): ReadyCuaActionSettlement | null {
  return defaultCoordinator.takeReadySettlement(currentContentRevision);
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
