import { describe, expect, it } from 'vitest';

import type { CuaSaveReadyRequest, CuaSaveResult, CuaSaveSnapshotRequest } from '../src/shared/cuaSave';
import type { LocalProjectSnapshot } from '../src/shared/timelineTypes';
import {
  buildCuaSaveSnapshotReport,
  evaluateCuaSaveFinished,
  evaluateCuaSaveReadyRequest,
  type LiveEditorSaveState
} from '../src/renderer/src/cua/cuaSaveClient';

const mockProject: Pick<LocalProjectSnapshot, 'id' | 'timeline'> = {
  id: 'proj-save-1',
  timeline: {
    schemaVersion: 3,
    tracks: [
      { id: 'v1', name: 'Video 1', kind: 'video', clips: [] },
      { id: 'a1', name: 'Audio 1', kind: 'audio', clips: [], mix: { gainDb: 0, pan: 0, muted: false } }
    ],
    titles: [],
    transitions: []
  }
};

function makeState(overrides: Partial<LiveEditorSaveState> = {}): LiveEditorSaveState {
  return {
    project: mockProject,
    contentRevision: 4,
    hasUnsavedTimeline: true,
    isSavingTimeline: false,
    cuaSaveFreezeToken: null,
    hasActiveDrag: false,
    ...overrides
  };
}

const sampleSnapshotRequest: CuaSaveSnapshotRequest = {
  requestToken: 'req-tok-1',
  scope: {
    projectId: 'proj-save-1',
    sessionId: 'sess-1',
    runId: 'run-1',
    windowId: 1,
    frameId: 'frame-1',
    layoutRevision: 3,
    contentRevision: 4
  }
};

const sampleReadyRequest: CuaSaveReadyRequest = {
  saveToken: 'save-tok-1',
  proposal: {
    proposalId: 'prop-1',
    snapshotId: 'snap-1',
    timelineDigest: 'abc123digest',
    scope: sampleSnapshotRequest.scope,
    dirty: true,
    clipCount: 0,
    titleCount: 0,
    summary: 'Save timeline'
  }
};

describe('cuaSaveClient', () => {
  it('reports a readonly cloned timeline snapshot only when projectId, contentRevision, and idle state match', () => {
    const report = buildCuaSaveSnapshotReport(sampleSnapshotRequest, makeState());
    expect(report).not.toBeNull();
    expect(report).toMatchObject({
      requestToken: 'req-tok-1',
      runId: 'run-1',
      projectId: 'proj-save-1',
      contentRevision: 4,
      dirty: true
    });
    expect(report?.timeline).not.toBe(mockProject.timeline);

    expect(buildCuaSaveSnapshotReport(sampleSnapshotRequest, makeState({ contentRevision: 5 }))).toBeNull();
    expect(buildCuaSaveSnapshotReport(sampleSnapshotRequest, makeState({ project: null }))).toBeNull();
    expect(buildCuaSaveSnapshotReport(sampleSnapshotRequest, makeState({ isSavingTimeline: true }))).toBeNull();
    expect(buildCuaSaveSnapshotReport(sampleSnapshotRequest, makeState({ cuaSaveFreezeToken: 'other-tok' }))).toBeNull();
    expect(buildCuaSaveSnapshotReport(sampleSnapshotRequest, makeState({ hasActiveDrag: true }))).toBeNull();
  });

  it('freezes and acknowledges ready=true on exact scope match, and rejects with exact protocol error codes otherwise', () => {
    const ok = evaluateCuaSaveReadyRequest(sampleReadyRequest, makeState());
    expect(ok.freezeToken).toBe('save-tok-1');
    expect(ok.ack).toEqual({
      saveToken: 'save-tok-1',
      runId: 'run-1',
      projectId: 'proj-save-1',
      contentRevision: 4,
      snapshotId: 'snap-1',
      timelineDigest: 'abc123digest',
      ready: true
    });

    const staleRev = evaluateCuaSaveReadyRequest(sampleReadyRequest, makeState({ contentRevision: 5 }));
    expect(staleRev.freezeToken).toBeNull();
    expect(staleRev.ack.ready).toBe(false);
    expect(staleRev.ack.errorCode).toBe('CUA_SAVE_SCOPE_CHANGED');
    expect(staleRev.ack.contentRevision).toBe(4);

    const busy = evaluateCuaSaveReadyRequest(sampleReadyRequest, makeState({ isSavingTimeline: true }));
    expect(busy.freezeToken).toBeNull();
    expect(busy.ack.ready).toBe(false);
    expect(busy.ack.errorCode).toBe('CUA_SAVE_BUSY');

    const dragging = evaluateCuaSaveReadyRequest(sampleReadyRequest, makeState({ hasActiveDrag: true }));
    expect(dragging.freezeToken).toBeNull();
    expect(dragging.ack.ready).toBe(false);
    expect(dragging.ack.errorCode).toBe('CUA_SAVE_RENDERER_NOT_READY');
  });

  it('always releases freeze on finish and applies clean UI only when diskMatches===true at matching contentRevision', () => {
    const baseResult: CuaSaveResult = {
      saveToken: 'save-tok-1',
      runId: 'run-1',
      projectId: 'proj-save-1',
      snapshotId: 'snap-1',
      timelineDigest: 'abc123digest',
      expectedContentRevision: 4,
      persistedUpdatedAt: '2026-01-02T00:00:00.000Z',
      status: 'persisted',
      diskMatches: true,
      uiApplied: false,
      errorCode: null
    };

    const applied = evaluateCuaSaveFinished(baseResult, makeState({ cuaSaveFreezeToken: 'save-tok-1' }));
    expect(applied.releaseFreeze).toBe(true);
    expect(applied.applyCleanUi).toBe(true);
    expect(applied.saveError).toBeNull();
    expect(applied.commitAck).toEqual({
      saveToken: 'save-tok-1',
      runId: 'run-1',
      projectId: 'proj-save-1',
      contentRevision: 4,
      uiApplied: true
    });

    // Newer local edit diverged before finish -> never clear dirty, ack uiApplied: false.
    const diverged = evaluateCuaSaveFinished(
      baseResult,
      makeState({ cuaSaveFreezeToken: 'save-tok-1', contentRevision: 5 })
    );
    expect(diverged.releaseFreeze).toBe(true);
    expect(diverged.applyCleanUi).toBe(false);
    expect(diverged.commitAck?.uiApplied).toBe(false);

    // Readback not verified -> never clear dirty, surface CUA_SAVE_NOT_VERIFIED / errorCode.
    const unverified = evaluateCuaSaveFinished(
      { ...baseResult, diskMatches: null, errorCode: 'CUA_SAVE_READBACK_FAILED' },
      makeState({ cuaSaveFreezeToken: 'save-tok-1' })
    );
    expect(unverified.releaseFreeze).toBe(true);
    expect(unverified.applyCleanUi).toBe(false);
    expect(unverified.saveError).toBe('CUA_SAVE_READBACK_FAILED');
    expect(unverified.commitAck?.uiApplied).toBe(false);

    // Not written (cancelled) -> releases freeze, no commitAck, keeps dirty state intact.
    const notWritten = evaluateCuaSaveFinished(
      { ...baseResult, status: 'not-written', diskMatches: null, persistedUpdatedAt: null, errorCode: 'CUA_SAVE_CANCELLED' },
      makeState({ cuaSaveFreezeToken: 'save-tok-1' })
    );
    expect(notWritten.releaseFreeze).toBe(true);
    expect(notWritten.applyCleanUi).toBe(false);
    expect(notWritten.saveError).toBeNull();
    expect(notWritten.commitAck).toBeNull();

    // Ambiguous write outcome -> releases freeze, keeps dirty, surfaces error.
    const unknown = evaluateCuaSaveFinished(
      { ...baseResult, status: 'write-outcome-unknown', diskMatches: null, persistedUpdatedAt: null, errorCode: 'CUA_SAVE_FAILED' },
      makeState({ cuaSaveFreezeToken: 'save-tok-1' })
    );
    expect(unknown.releaseFreeze).toBe(true);
    expect(unknown.applyCleanUi).toBe(false);
    expect(unknown.saveError).toBe('CUA_SAVE_FAILED');
    expect(unknown.commitAck).toBeNull();
  });
});
