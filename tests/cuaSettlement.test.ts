import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { CuaDriver } from '../src/main/cuaDriver';
import { INITIAL_CUA_STATE } from '../src/renderer/src/cua/cuaSurfaceSnapshot';
import {
  parseEditorShortcutPreferences,
  resolveTimelineShortcutAction
} from '../src/renderer/src/editor/editorShortcuts';
import type { CuaAction, CuaActionSettlementAck, CuaActionSettlementTag, CuaPostInputState, CuaState, CuaSurfaceSnapshot } from '../src/shared/cua';

interface ReadyCuaActionSettlement {
  readonly tag: CuaActionSettlementTag;
  readonly outcome: CuaActionSettlementAck['outcome'];
  readonly baseContentRevision: number;
}

interface CuaActionSettlementCoordinatorInstance {
  getTracker(): Readonly<{
    readonly tag: CuaActionSettlementTag;
    readonly actionKind: CuaAction['kind'];
    readonly stage: CuaPostInputState['stage'];
    readonly baseContentRevision: number;
    readonly baseContentFingerprint: string | null;
    readonly attribution: {
      readonly expectCommit: boolean;
      readonly expectedContentFingerprint: string | null;
    } | null;
    readonly tainted: boolean;
    readonly consumed: boolean;
  }> | null;
  clear(): void;
  syncFromCuaState(state: CuaState, currentContentRevision: number, currentContentFingerprint?: string | null): void;
  notifyTimelineMutationScheduled(expectedFingerprint?: string): void;
  notifyExternalTimelineMutation(): void;
  runWithAttribution<T>(actionKind: CuaAction['kind'], fn: () => T): T;
  beginClickAttribution(): boolean;
  completeClickAttribution(): boolean;
  shouldDeferAttributedContentReport(currentContentRevision: number, currentContentFingerprint?: string | null): boolean;
  takeReadySettlement(currentContentRevision: number, currentContentFingerprint?: string | null): ReadyCuaActionSettlement | null;
}

interface CuaSettlementModule {
  readonly CuaActionSettlementCoordinator: new () => CuaActionSettlementCoordinatorInstance;
}

async function loadSettlementModule(): Promise<CuaSettlementModule> {
  const modulePath = '../src/renderer/src/cua/cuaActionSettlement.ts';
  return (await import(modulePath)) as CuaSettlementModule;
}

const VALID_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000004c4000003190806000000',
  'hex'
);

function makePostInput(overrides: Partial<CuaPostInputState> = {}): CuaPostInputState {
  return {
    sessionId: 'sess-1',
    runId: 'run-1',
    windowId: 7,
    actionId: 'act-1',
    generation: 0,
    settlementToken: 'tok-1',
    actionKind: 'drag',
    stage: 'prepared',
    ...overrides
  };
}

function makeState(overrides: Partial<CuaState> = {}): CuaState {
  return {
    ...INITIAL_CUA_STATE,
    sessionId: 'sess-1',
    runId: 'run-1',
    windowId: 7,
    phase: 'acting',
    ...overrides
  };
}

function createDriverFixture() {
  const winEmitter = new EventEmitter();
  const webContentsEmitter = new EventEmitter();
  const sendInputEvent = vi.fn();
  const onCancel = vi.fn();
  const consumePermit = vi.fn();
  const checkPermit = vi.fn();
  const states: CuaState[] = [];
  let onStateHook: ((state: CuaState) => void) | null = null;

  const webContents = Object.assign(webContentsEmitter, {
    isDestroyed: () => false,
    isFocused: () => true,
    getZoomFactor: () => 1,
    sendInputEvent,
    executeJavaScript: vi.fn(async (script: string) => {
      if (script.includes('[data-cua-protected="agent-panel"]')) {
        return { x: 854, y: 52, width: 360, height: 735 };
      }
      return true;
    }),
    capturePage: vi.fn(async () => ({
      isEmpty: () => false,
      toPNG: () => VALID_PNG
    }))
  });

  const window = Object.assign(winEmitter, {
    id: 7,
    isDestroyed: () => false,
    isFocused: () => true,
    webContents
  }) as unknown as BrowserWindow;

  const surface: CuaSurfaceSnapshot = {
    contentRevision: 1,
    executionBlocked: false,
    blockReason: null,
    layoutRevision: 5,
    viewport: { width: 1220, height: 793 },
    safeSurface: { kind: 'timeline', rect: { x: 8, y: 512, width: 828, height: 274 }, interactive: true },
    protectedRects: [
      { id: 'agent-chat-panel', kind: 'agent-panel', rect: { x: 854, y: 52, width: 360, height: 735 } }
    ],
    focusedInSafeSurface: true,
    focusedTestId: 'timeline-clip-1'
  };

  const driver = new CuaDriver(window, {
    consumePermit,
    checkPermit,
    onCancel,
    onState: (state) => {
      states.push(state);
      onStateHook?.(state);
    }
  });
  driver.setExecutionBlocked(false);
  driver.reportSurface(surface);

  return {
    driver,
    surface,
    sendInputEvent,
    onCancel,
    states,
    setOnStateHook: (fn: (state: CuaState) => void) => {
      onStateHook = fn;
    }
  };
}

describe('CuaActionSettlementCoordinator (renderer post-input action attribution)', () => {
  it('attributes drag commit (contentRevision 1 -> 2) once with settlement tag and leaves subsequent external 2 -> 3 untagged', async () => {
    const { CuaActionSettlementCoordinator } = await loadSettlementModule();
    const coordinator = new CuaActionSettlementCoordinator();
    const reportedCalls: Array<{ contentRevision: number; settlement?: CuaActionSettlementTag }> = [];
    const ackCalls: Array<{ outcome: 'committed' | 'noop'; contentRevision: number; actionId: string }> = [];

    const reportAndAck = (contentRevision: number) => {
      const ready = coordinator.takeReadySettlement(contentRevision);
      if (ready !== null) {
        reportedCalls.push({ contentRevision, settlement: ready.tag });
        ackCalls.push({ outcome: ready.outcome, contentRevision, actionId: ready.tag.actionId });
        return;
      }
      if (!coordinator.shouldDeferAttributedContentReport(contentRevision)) {
        reportedCalls.push({ contentRevision });
      }
    };

    // 1. Registered at preparing (stage=prepared): no premature ACK.
    coordinator.syncFromCuaState(makeState({ phase: 'preparing', postInput: makePostInput({ stage: 'prepared' }) }), 1);
    expect(coordinator.takeReadySettlement(1)).toBeNull();

    // 2. Armed before drag mouseUp; real pointerup handler runs and schedules a timeline mutation.
    coordinator.syncFromCuaState(makeState({ phase: 'acting', postInput: makePostInput({ stage: 'armed' }) }), 1);
    coordinator.runWithAttribution('drag', () => {
      coordinator.notifyTimelineMutationScheduled();
    });

    // If React commits contentRevision=2 right before stage='released' arrives, defer untagged leak.
    expect(coordinator.shouldDeferAttributedContentReport(2)).toBe(true);
    expect(coordinator.takeReadySettlement(2)).toBeNull();

    // 3. Stage advances to released -> single tagged report + committed ACK!
    coordinator.syncFromCuaState(makeState({ phase: 'acting', postInput: makePostInput({ stage: 'released' }) }), 2);
    reportAndAck(2);

    expect(reportedCalls).toHaveLength(1);
    expect(reportedCalls[0]).toMatchObject({ contentRevision: 2, settlement: { actionId: 'act-1', settlementToken: 'tok-1' } });
    expect(ackCalls).toEqual([{ outcome: 'committed', contentRevision: 2, actionId: 'act-1' }]);

    // 4. One-shot consumption: cannot replay or tag a subsequent external rev 2 -> 3 edit.
    expect(coordinator.takeReadySettlement(2)).toBeNull();
    reportAndAck(3);
    expect(reportedCalls).toHaveLength(2);
    expect(reportedCalls[1]).toEqual({ contentRevision: 3 });
    expect(reportedCalls[1]!.settlement).toBeUndefined();
    expect(ackCalls).toHaveLength(1);
  });

  it('attributes click selection (no contentRevision bump) and zero-mutation drag as noop once after release', async () => {
    const { CuaActionSettlementCoordinator } = await loadSettlementModule();
    // Case A: click selection (no timeline content mutation)
    const clickCoordinator = new CuaActionSettlementCoordinator();
    clickCoordinator.syncFromCuaState(
      makeState({ phase: 'preparing', postInput: makePostInput({ actionId: 'act-click', actionKind: 'click', stage: 'prepared' }) }),
      1
    );
    clickCoordinator.syncFromCuaState(
      makeState({ phase: 'acting', postInput: makePostInput({ actionId: 'act-click', actionKind: 'click', stage: 'armed' }) }),
      1
    );
    expect(clickCoordinator.beginClickAttribution()).toBe(true);
    // Target click only calls setSelectedClipId / setPlayheadMs (no notifyTimelineMutationScheduled).
    expect(clickCoordinator.completeClickAttribution()).toBe(true);
    expect(clickCoordinator.takeReadySettlement(1)).toBeNull(); // still armed, not released

    clickCoordinator.syncFromCuaState(
      makeState({ phase: 'acting', postInput: makePostInput({ actionId: 'act-click', actionKind: 'click', stage: 'released' }) }),
      1
    );
    const clickReady = clickCoordinator.takeReadySettlement(1);
    expect(clickReady).toMatchObject({ outcome: 'noop', baseContentRevision: 1, tag: { actionId: 'act-click' } });
    expect(clickCoordinator.takeReadySettlement(1)).toBeNull();

    // Case B: zero-mutation drag (dropped back at original position)
    const dragCoordinator = new CuaActionSettlementCoordinator();
    dragCoordinator.syncFromCuaState(
      makeState({ phase: 'preparing', postInput: makePostInput({ actionId: 'act-drag-noop', actionKind: 'drag', stage: 'prepared' }) }),
      4
    );
    dragCoordinator.syncFromCuaState(
      makeState({ phase: 'acting', postInput: makePostInput({ actionId: 'act-drag-noop', actionKind: 'drag', stage: 'released' }) }),
      4
    );
    dragCoordinator.runWithAttribution('drag', () => {
      // No timeline mutation occurred (unchanged drop position).
    });
    const dragNoop = dragCoordinator.takeReadySettlement(4);
    expect(dragNoop).toMatchObject({ outcome: 'noop', baseContentRevision: 4, tag: { actionId: 'act-drag-noop' } });
  });

  it('attributes fixed-keymap blocked remapped key (saveTimeline -> ArrowUp) as noop with zero legacy Save calls', async () => {
    const { CuaActionSettlementCoordinator } = await loadSettlementModule();
    const coordinator = new CuaActionSettlementCoordinator();
    const remappedPrefs = {
      ...parseEditorShortcutPreferences(null),
      overrides: {
        ...parseEditorShortcutPreferences(null).overrides,
        saveTimeline: { modifiers: [] as const, key: 'ArrowUp' }
      }
    };
    let legacySaveCalls = 0;

    coordinator.syncFromCuaState(
      makeState({ phase: 'preparing', postInput: makePostInput({ actionId: 'act-key', actionKind: 'key', stage: 'prepared' }) }),
      2
    );
    coordinator.syncFromCuaState(
      makeState({ phase: 'acting', postInput: makePostInput({ actionId: 'act-key', actionKind: 'key', stage: 'armed' }) }),
      2
    );

    // Simulates useTimelineShortcuts onKeyDown during cuaActing=true:
    coordinator.runWithAttribution('key', () => {
      const action = resolveTimelineShortcutAction({
        event: { key: 'ArrowUp', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
        shortcutPreferences: remappedPrefs,
        isLocked: true,
        cuaActing: true
      });
      if (action === 'saveTimeline') {
        legacySaveCalls += 1;
      }
    });

    coordinator.syncFromCuaState(
      makeState({ phase: 'acting', postInput: makePostInput({ actionId: 'act-key', actionKind: 'key', stage: 'released' }) }),
      2
    );
    const ready = coordinator.takeReadySettlement(2);
    expect(legacySaveCalls).toBe(0);
    expect(ready).toMatchObject({ outcome: 'noop', baseContentRevision: 2, tag: { actionId: 'act-key' } });
  });

  it('keeps unattributed external changes untagged, fabricates zero noop ACKs when no handler ran, and blocks pre-input ACKs', async () => {
    const { CuaActionSettlementCoordinator } = await loadSettlementModule();
    const coordinator = new CuaActionSettlementCoordinator();

    // 1. Pre-input (stage === 'prepared'): even if handler were invoked early, never yields ready settlement.
    coordinator.syncFromCuaState(makeState({ phase: 'preparing', postInput: makePostInput({ stage: 'prepared' }) }), 1);
    expect(coordinator.takeReadySettlement(1)).toBeNull();

    // 2. Armed -> released with NO matching DOM handler running:
    coordinator.syncFromCuaState(makeState({ phase: 'acting', postInput: makePostInput({ stage: 'armed' }) }), 1);
    // External unattributed content mutation (e.g., MCP edit or resize/blur) must NOT be deferred or tagged!
    expect(coordinator.shouldDeferAttributedContentReport(2)).toBe(false);
    expect(coordinator.takeReadySettlement(2)).toBeNull();

    coordinator.syncFromCuaState(makeState({ phase: 'acting', postInput: makePostInput({ stage: 'released' }) }), 1);
    // Still NO matching DOM handler ran -> zero fabricated noop ACK!
    expect(coordinator.takeReadySettlement(1)).toBeNull();
    expect(coordinator.takeReadySettlement(2)).toBeNull();

    // 3. Cancel/stop clears tracker immediately.
    coordinator.syncFromCuaState(makeState({ phase: 'stopped', postInput: null }), 1);
    expect(coordinator.getTracker()).toBeNull();
  });

  it('integrates end-to-end with real CuaDriver: deferred drag commit settles rev=2 and first post-action observe sees rev=2', async () => {
    const { CuaActionSettlementCoordinator } = await loadSettlementModule();
    const f = createDriverFixture();
    const coordinator = new CuaActionSettlementCoordinator();
    let currentContentRevision = 1;
    let deferredCommitScheduled = false;

    const tryFlushSettlement = (): void => {
      const ready: ReadyCuaActionSettlement | null = coordinator.takeReadySettlement(currentContentRevision);
      if (ready === null) return;
      const nextSurface: CuaSurfaceSnapshot = { ...f.surface, contentRevision: currentContentRevision };
      const accepted = f.driver.reportSurface(nextSurface, ready.tag);
      expect(accepted).toBe(true);
      const acked = f.driver.acknowledgeActionSettlement({
        ...ready.tag,
        layoutRevision: nextSurface.layoutRevision,
        contentRevision: nextSurface.contentRevision,
        outcome: ready.outcome
      });
      expect(acked).toBe(true);
    };

    f.setOnStateHook((nextState) => {
      coordinator.syncFromCuaState(nextState, currentContentRevision);

      if (nextState.phase === 'preparing' && nextState.prepareToken !== null && nextState.runId !== null) {
        queueMicrotask(() => {
          f.driver.acknowledgePrepare({ runId: nextState.runId!, prepareToken: nextState.prepareToken! });
        });
      }

      if (nextState.postInput?.stage === 'released') {
        queueMicrotask(() => {
          tryFlushSettlement();
        });
      }
    });

    // Simulate real TimelineCanvas pointerup landing on mouseUp and committing contentRevision=2 asynchronously (after React commit).
    f.sendInputEvent.mockImplementation((event: { type?: string }) => {
      if (event.type === 'mouseUp' && !deferredCommitScheduled) {
        deferredCommitScheduled = true;
        coordinator.runWithAttribution('drag', () => {
          coordinator.notifyTimelineMutationScheduled();
        });
        // Deferred React commit landing 10ms AFTER mouseUp & stage='released':
        setTimeout(() => {
          currentContentRevision = 2;
          tryFlushSettlement();
        }, 10);
      }
    });

    const initialFrame = await f.driver.observe({ sessionId: 'sess-1', runId: 'run-1' });
    expect(initialFrame.contentRevision).toBe(1);

    const endState = await f.driver.execute(
      {
        sessionId: 'sess-1',
        runId: 'run-1',
        windowId: 7,
        frameId: initialFrame.frameId,
        layoutRevision: initialFrame.layoutRevision,
        contentRevision: initialFrame.contentRevision,
        action: { kind: 'drag', from: { x: 200, y: 600 }, to: { x: 265, y: 600 }, durationMs: 100 }
      },
      'approved-permit'
    );

    expect(endState.phase).toBe('ready');
    expect(endState.cleanupComplete).toBe(true);
    expect(endState.lastDispatchReceipt?.rendererSettlement).toBe('acknowledged');
    expect(endState.lastDispatchReceipt?.observationReady).toBe(true);
    expect(f.onCancel).not.toHaveBeenCalled();

    // First post-action observe MUST see contentRevision=2 without spurious content-changed cancel!
    const postActionFrame = await f.driver.observe({ sessionId: 'sess-1', runId: 'run-1' });
    expect(postActionFrame.contentRevision).toBe(2);
    expect(f.onCancel).not.toHaveBeenCalled();

    // A subsequent UNTAGGED external contentRevision=3 report still cancels with content-changed!
    f.driver.reportSurface({ ...f.surface, contentRevision: 3 });
    expect(f.onCancel).toHaveBeenCalledWith(expect.objectContaining({ reason: 'content-changed' }));
  });

  it('wires settlement attribution across useCuaOverlay, TimelineCanvas, useTimelineEditor, and useTimelineShortcuts', async () => {
    const [overlaySrc, canvasSrc, editorSrc, shortcutsSrc] = await Promise.all([
      readFile(new URL('../src/renderer/src/cua/useCuaOverlay.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/renderer/src/editor/TimelineCanvas.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/renderer/src/editor/useTimelineEditor.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/renderer/src/editor/useTimelineShortcuts.ts', import.meta.url), 'utf8')
    ]);

    expect(overlaySrc).toContain('syncCuaActionSettlementFromState(');
    expect(overlaySrc).toContain('takeReadyCuaActionSettlement(');
    expect(overlaySrc).toContain('api.cuaReportSurfaceSnapshot(nextSnapshot, settlement)');
    expect(overlaySrc).toContain('api.cuaAckActionSettlement({');
    expect(canvasSrc).toContain("runWithCuaActionAttribution('drag'");
    expect(editorSrc).toContain('computeTimelineContentFingerprint(');
    expect(editorSrc).toContain('notifyCuaTimelineMutationScheduled(');
    expect(editorSrc).toContain('notifyExternalCuaTimelineMutation()');
    expect(shortcutsSrc).toContain("runWithCuaActionAttribution('key'");
  });

  it('blocks Backend repro: out-of-scope external mutation after drag attribution taints tracker and cancels CuaDriver with content-changed', async () => {
    const { CuaActionSettlementCoordinator } = await loadSettlementModule();
    const f = createDriverFixture();
    const coordinator = new CuaActionSettlementCoordinator();
    const fp1 = '["p1",{"clip":0},[]]';
    const fp2 = '["p1",{"clip":115},[]]';
    const fp3 = '["p1",{"clip":115,"ext":true},[]]';
    let currentContentRevision = 1;
    let currentFingerprint = fp1;
    let reportedUntagged = 0;

    const flush = (): void => {
      const ready = coordinator.takeReadySettlement(currentContentRevision, currentFingerprint);
      if (ready !== null) {
        const nextSurface: CuaSurfaceSnapshot = { ...f.surface, contentRevision: currentContentRevision };
        if (f.driver.reportSurface(nextSurface, ready.tag)) {
          f.driver.acknowledgeActionSettlement({
            ...ready.tag,
            layoutRevision: nextSurface.layoutRevision,
            contentRevision: nextSurface.contentRevision,
            outcome: ready.outcome
          });
        }
        return;
      }
      if (!coordinator.shouldDeferAttributedContentReport(currentContentRevision, currentFingerprint)) {
        reportedUntagged += 1;
        f.driver.reportSurface({ ...f.surface, contentRevision: currentContentRevision });
      }
    };

    f.setOnStateHook((nextState) => {
      coordinator.syncFromCuaState(nextState, currentContentRevision, currentFingerprint);
      if (nextState.phase === 'preparing' && nextState.prepareToken !== null && nextState.runId !== null) {
        queueMicrotask(() => {
          f.driver.acknowledgePrepare({ runId: nextState.runId!, prepareToken: nextState.prepareToken! });
        });
      }
    });

    f.sendInputEvent.mockImplementation((event: { type?: string }) => {
      if (event.type === 'mouseUp') {
        // 1. Real attributed CUA drag schedules rev 1 -> 2 (fp2).
        coordinator.runWithAttribution('drag', () => {
          coordinator.notifyTimelineMutationScheduled(fp2);
        });
        // 2. External unattributed edit runs OUTSIDE attribution scope -> rev becomes 3 (fp3)!
        coordinator.notifyTimelineMutationScheduled(fp3);
        currentContentRevision = 3;
        currentFingerprint = fp3;

        expect(coordinator.getTracker()?.tainted).toBe(true);
        expect(coordinator.shouldDeferAttributedContentReport(3, fp3)).toBe(false);
        expect(coordinator.takeReadySettlement(3, fp3)).toBeNull();

        queueMicrotask(() => flush());
      }
    });

    const initialFrame = await f.driver.observe({ sessionId: 'sess-1', runId: 'run-1' });
    const endState = await f.driver.execute(
      {
        sessionId: 'sess-1',
        runId: 'run-1',
        windowId: 7,
        frameId: initialFrame.frameId,
        layoutRevision: initialFrame.layoutRevision,
        contentRevision: initialFrame.contentRevision,
        action: { kind: 'drag', from: { x: 200, y: 600 }, to: { x: 265, y: 600 }, durationMs: 100 }
      },
      'approved-permit'
    );

    expect(reportedUntagged).toBeGreaterThanOrEqual(1);
    expect(f.onCancel).toHaveBeenCalledWith(expect.objectContaining({ reason: 'content-changed' }));
    expect(endState.phase).toBe('stopped');
    expect(endState.lastDispatchReceipt?.rendererSettlement).toBe('cancelled');
  });

  it('catches same-React-commit batching (Layer 2 fingerprint mismatch even when contentRevision increments 1 -> 2 only once)', async () => {
    const { CuaActionSettlementCoordinator } = await loadSettlementModule();
    const f = createDriverFixture();
    const coordinator = new CuaActionSettlementCoordinator();
    const fpBase = '["p1",{"clip":0},[]]';
    const fpAttributedOnly = '["p1",{"clip":115},[]]';
    const fpCombinedWithExternal = '["p1",{"clip":115,"externalMcpTitle":"injected"},[]]';
    let currentContentRevision = 1;
    let currentFingerprint = fpBase;
    let sentTagged = 0;
    let releaseChecked = false;
    let taintedObserved = false;

    f.setOnStateHook((nextState) => {
      coordinator.syncFromCuaState(nextState, currentContentRevision, currentFingerprint);
      if (nextState.phase === 'preparing' && nextState.prepareToken !== null && nextState.runId !== null) {
        queueMicrotask(() => {
          f.driver.acknowledgePrepare({ runId: nextState.runId!, prepareToken: nextState.prepareToken! });
        });
      }
      if (nextState.postInput?.stage === 'released' && !releaseChecked) {
        releaseChecked = true;
        queueMicrotask(() => {
          // Even if an external mutation bypassed Layer 1 and batched into the exact same React
          // commit (so contentRevision only bumped once from 1 -> 2), Layer 2 sees
          // fpCombinedWithExternal !== fpAttributedOnly and rejects attribution!
          const deferred = coordinator.shouldDeferAttributedContentReport(2, fpCombinedWithExternal);
          const ready = coordinator.takeReadySettlement(2, fpCombinedWithExternal);
          taintedObserved = !deferred && ready === null && coordinator.getTracker()?.tainted === true;
          if (ready !== null) {
            sentTagged += 1;
          } else {
            f.driver.reportSurface({ ...f.surface, contentRevision: 2 });
          }
        });
      }
    });

    f.sendInputEvent.mockImplementation((event: { type?: string }) => {
      if (event.type === 'mouseUp') {
        coordinator.runWithAttribution('drag', () => {
          coordinator.notifyTimelineMutationScheduled(fpAttributedOnly);
        });
        currentContentRevision = 2;
        currentFingerprint = fpCombinedWithExternal;
      }
    });

    const initialFrame = await f.driver.observe({ sessionId: 'sess-1', runId: 'run-1' });
    const endState = await f.driver.execute(
      {
        sessionId: 'sess-1',
        runId: 'run-1',
        windowId: 7,
        frameId: initialFrame.frameId,
        layoutRevision: initialFrame.layoutRevision,
        contentRevision: initialFrame.contentRevision,
        action: { kind: 'drag', from: { x: 200, y: 600 }, to: { x: 265, y: 600 }, durationMs: 100 }
      },
      'approved-permit'
    );

    expect(taintedObserved).toBe(true);
    expect(sentTagged).toBe(0);
    expect(f.onCancel).toHaveBeenCalledWith(expect.objectContaining({ reason: 'content-changed' }));
    expect(endState.phase).toBe('stopped');
  });

  it('taints tracker permanently on external edit BEFORE runWithAttribution (prepared/armed) and AFTER noop attribution before ACK', async () => {
    const { CuaActionSettlementCoordinator } = await loadSettlementModule();

    // Case A: external edit while stage === 'prepared' before handler runs
    const preCoord = new CuaActionSettlementCoordinator();
    preCoord.syncFromCuaState(makeState({ phase: 'preparing', postInput: makePostInput({ stage: 'prepared' }) }), 1, 'fp-1');
    preCoord.notifyExternalTimelineMutation();
    expect(preCoord.getTracker()?.tainted).toBe(true);

    preCoord.syncFromCuaState(makeState({ phase: 'acting', postInput: makePostInput({ stage: 'armed' }) }), 2, 'fp-ext');
    preCoord.runWithAttribution('drag', () => {
      preCoord.notifyTimelineMutationScheduled('fp-drag');
    });
    preCoord.syncFromCuaState(makeState({ phase: 'acting', postInput: makePostInput({ stage: 'released' }) }), 3, 'fp-drag');
    expect(preCoord.shouldDeferAttributedContentReport(3, 'fp-drag')).toBe(false);
    expect(preCoord.takeReadySettlement(3, 'fp-drag')).toBeNull();

    // Case B: external edit while stage === 'armed' before handler runs
    const armedCoord = new CuaActionSettlementCoordinator();
    armedCoord.syncFromCuaState(makeState({ phase: 'preparing', postInput: makePostInput({ actionId: 'act-2', stage: 'prepared' }) }), 1, 'fp-1');
    armedCoord.syncFromCuaState(makeState({ phase: 'acting', postInput: makePostInput({ actionId: 'act-2', stage: 'armed' }) }), 1, 'fp-1');
    armedCoord.notifyTimelineMutationScheduled('fp-ext'); // outside runWithAttribution -> taints immediately!
    expect(armedCoord.getTracker()?.tainted).toBe(true);
    armedCoord.runWithAttribution('drag', () => {
      armedCoord.notifyTimelineMutationScheduled('fp-drag');
    });
    armedCoord.syncFromCuaState(makeState({ phase: 'acting', postInput: makePostInput({ actionId: 'act-2', stage: 'released' }) }), 2, 'fp-drag');
    expect(armedCoord.takeReadySettlement(2, 'fp-drag')).toBeNull();

    // Case C: external edit AFTER noop attribution before ACK
    const noopCoord = new CuaActionSettlementCoordinator();
    noopCoord.syncFromCuaState(
      makeState({ phase: 'preparing', postInput: makePostInput({ actionId: 'act-noop', actionKind: 'click', stage: 'prepared' }) }),
      5,
      'fp-5'
    );
    noopCoord.syncFromCuaState(
      makeState({ phase: 'acting', postInput: makePostInput({ actionId: 'act-noop', actionKind: 'click', stage: 'armed' }) }),
      5,
      'fp-5'
    );
    expect(noopCoord.beginClickAttribution()).toBe(true);
    expect(noopCoord.completeClickAttribution()).toBe(true);
    // External edit lands before stage='released' / ACK:
    noopCoord.notifyTimelineMutationScheduled('fp-6');
    expect(noopCoord.getTracker()?.tainted).toBe(true);
    noopCoord.syncFromCuaState(
      makeState({ phase: 'acting', postInput: makePostInput({ actionId: 'act-noop', actionKind: 'click', stage: 'released' }) }),
      6,
      'fp-6'
    );
    expect(noopCoord.takeReadySettlement(6, 'fp-6')).toBeNull();
    expect(noopCoord.takeReadySettlement(5, 'fp-5')).toBeNull();
  });

  it('strictly rejects multi-step revision jump (base=1 -> rev=3) even without explicit Layer 1 taint call, while allowing clean base=1 -> rev=2 with matching fingerprint', async () => {
    const { CuaActionSettlementCoordinator } = await loadSettlementModule();

    // Multi-step rev jump without Layer 1 call (defense-in-depth Layer 2 check):
    const jumpCoord = new CuaActionSettlementCoordinator();
    jumpCoord.syncFromCuaState(makeState({ phase: 'preparing', postInput: makePostInput({ stage: 'prepared' }) }), 1, 'fp-1');
    jumpCoord.syncFromCuaState(makeState({ phase: 'acting', postInput: makePostInput({ stage: 'armed' }) }), 1, 'fp-1');
    jumpCoord.runWithAttribution('drag', () => {
      jumpCoord.notifyTimelineMutationScheduled('fp-2');
    });
    expect(jumpCoord.shouldDeferAttributedContentReport(3, 'fp-3')).toBe(false);
    expect(jumpCoord.getTracker()?.tainted).toBe(true);
    jumpCoord.syncFromCuaState(makeState({ phase: 'acting', postInput: makePostInput({ stage: 'released' }) }), 3, 'fp-3');
    expect(jumpCoord.takeReadySettlement(3, 'fp-3')).toBeNull();

    // Clean single attributed drag (base=1 -> rev=2, exact fp-2 match):
    const cleanCoord = new CuaActionSettlementCoordinator();
    cleanCoord.syncFromCuaState(makeState({ phase: 'preparing', postInput: makePostInput({ actionId: 'act-clean', stage: 'prepared' }) }), 1, 'fp-1');
    cleanCoord.syncFromCuaState(makeState({ phase: 'acting', postInput: makePostInput({ actionId: 'act-clean', stage: 'armed' }) }), 1, 'fp-1');
    cleanCoord.runWithAttribution('drag', () => {
      cleanCoord.notifyTimelineMutationScheduled('fp-2');
    });
    expect(cleanCoord.shouldDeferAttributedContentReport(2, 'fp-2')).toBe(true);
    cleanCoord.syncFromCuaState(makeState({ phase: 'acting', postInput: makePostInput({ actionId: 'act-clean', stage: 'released' }) }), 2, 'fp-2');
    expect(cleanCoord.takeReadySettlement(2, 'fp-2')).toMatchObject({
      outcome: 'committed',
      baseContentRevision: 1,
      tag: { actionId: 'act-clean' }
    });
    // Permanently consumed after one use:
    expect(cleanCoord.takeReadySettlement(2, 'fp-2')).toBeNull();
  });
});
