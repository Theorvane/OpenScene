import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { expect, it, vi } from 'vitest';
import { CuaSaveBridge, cuaSaveDigest } from '../src/main/cuaSaveBridge';
import { ProjectStore } from '../src/main/projectStore';
import { IPC_CHANNELS } from '../src/shared/ipc';
import type { CuaSaveReadyRequest, CuaSaveResult, CuaSaveScope, CuaSaveSnapshotRequest } from '../src/shared/cuaSave';
import type { TimelineDocument } from '../src/shared/timelineTypes';

async function withBridge(run: (context: Awaited<ReturnType<typeof fixture>>) => Promise<void>): Promise<void> {
  const f = await fixture();
  try { await run(f); } finally { await f.bridge.settleWrites(); await rm(f.root, { recursive: true, force: true }); }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cua-save-bridge-')), store = new ProjectStore(root);
  const project = await store.create({ name: 'Live timeline' });
  const timeline = { ...project.timeline, tracks: project.timeline.tracks.map((track, index) => index === 0 ? { ...track, name: 'Unsaved live edit' } : track) };
  const scope: CuaSaveScope = { projectId: project.id, sessionId: 's', runId: 'r', windowId: 7, frameId: 'f', layoutRevision: 1, contentRevision: 2 };
  const options: { ready: boolean; commit: boolean; uiApplied: boolean; dirty: boolean; snapshotTimeline: TimelineDocument } = { ready: true, commit: true, uiApplied: true, dirty: true, snapshotTimeline: timeline };
  const emitted: { channel: string; payload: unknown }[] = [];
  const checkPermit = vi.fn(), consumePermit = vi.fn(), assertScope = vi.fn();
  const window = { id: 7, isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel: string, payload: unknown) => {
    emitted.push({ channel, payload });
    if (channel === IPC_CHANNELS.cuaSaveSnapshotRequested) {
      const request = payload as CuaSaveSnapshotRequest;
      bridge.reportSnapshot({ requestToken: request.requestToken, runId: 'r', projectId: project.id, contentRevision: 2, dirty: options.dirty, timeline: options.snapshotTimeline });
    }
    if (channel === IPC_CHANNELS.cuaSaveRequested && options.ready) {
      const request = payload as CuaSaveReadyRequest;
      bridge.ackReady({ saveToken: request.saveToken, runId: 'r', projectId: project.id, contentRevision: 2, snapshotId: request.proposal.snapshotId, timelineDigest: request.proposal.timelineDigest, ready: true });
    }
    if (channel === IPC_CHANNELS.cuaSaveFinished && options.commit) {
      const result = payload as CuaSaveResult;
      bridge.ackCommit({ saveToken: result.saveToken, runId: 'r', projectId: project.id, contentRevision: 2, uiApplied: options.uiApplied });
    }
  } } } as unknown as BrowserWindow;
  const bridge = new CuaSaveBridge(window, { projects: store, assertScope, checkPermit, consumePermit });
  return { root, store, project, timeline, scope, options, emitted, bridge, checkPermit, consumePermit, assertScope };
}

it('binds immutable preapproval bytes, writes once, and distinguishes persisted state from newer UI edits', async () => {
  await withBridge(async f => {
    const proposal = await f.bridge.prepareSaveSnapshot(f.scope);
    expect(proposal.timelineDigest).toBe(cuaSaveDigest(f.timeline));
    (f.timeline.tracks[0] as { name: string }).name = 'Later mutation of reported object';
    f.options.uiApplied = false;
    const first = f.bridge.saveApproved(proposal.proposalId, 'save-permit');
    expect(f.bridge.saveApproved(proposal.proposalId, 'save-permit')).toBe(first);
    const result = await first;
    expect(result).toMatchObject({ status: 'persisted', diskMatches: true, uiApplied: false });
    expect((await f.store.open(f.project.id))!.timeline.tracks[0]!.name).toBe('Unsaved live edit');
    expect(f.consumePermit).toHaveBeenCalledOnce();
    await expect(f.bridge.saveApproved(proposal.proposalId, 'other-permit')).rejects.toThrow('ALREADY_EXECUTED');
  });
});

it('cancels before publication without changing the saved project and rejects late ready acknowledgements', async () => {
  await withBridge(async f => {
    const proposal = await f.bridge.prepareSaveSnapshot(f.scope);
    f.options.ready = false;
    const save = f.bridge.saveApproved(proposal.proposalId, 'permit');
    await Promise.resolve();
    const request = f.emitted.find(event => event.channel === IPC_CHANNELS.cuaSaveRequested)!.payload as CuaSaveReadyRequest;
    f.bridge.cancelRun('r');
    expect((await save).status).toBe('not-written');
    expect(f.consumePermit).not.toHaveBeenCalled();
    expect((await f.store.open(f.project.id))!.timeline).toEqual(f.project.timeline);
    expect(f.bridge.ackReady({ saveToken: request.saveToken, runId: 'r', projectId: f.project.id, contentRevision: 2, snapshotId: proposal.snapshotId, timelineDigest: proposal.timelineDigest, ready: true })).toBe(false);
  });
});

it('checks cancellation and permission again at final publication rather than only before staging', async () => {
  await withBridge(async f => {
    const proposal = await f.bridge.prepareSaveSnapshot(f.scope);
    f.consumePermit.mockImplementation(() => { throw new Error('CUA_SAVE_APPROVAL_EXPIRED'); });
    const result = await f.bridge.saveApproved(proposal.proposalId, 'expired');
    expect(result).toMatchObject({ status: 'not-written', errorCode: 'CUA_SAVE_APPROVAL_EXPIRED' });
    expect((await f.store.open(f.project.id))!.timeline).toEqual(f.project.timeline);
  });
});

it('retains a real publication receipt when cancellation arrives after the store has written', async () => {
  await withBridge(async f => {
    const proposal = await f.bridge.prepareSaveSnapshot(f.scope);
    const original = f.store.saveTimeline.bind(f.store);
    vi.spyOn(f.store, 'saveTimeline').mockImplementation(async (...args) => {
      const result = await original(...args);
      f.bridge.cancelRun('r');
      return result;
    });
    const result = await f.bridge.saveApproved(proposal.proposalId, 'approved');
    expect(result).toMatchObject({ status: 'persisted-after-cancel', diskMatches: true });
    expect((await f.store.open(f.project.id))!.timeline.tracks[0]!.name).toBe('Unsaved live edit');
  });
});

it('treats a clean report as already saved only after comparing real persisted bytes', async () => {
  await withBridge(async f => {
    f.options.dirty = false; f.options.snapshotTimeline = f.project.timeline;
    const proposal = await f.bridge.prepareSaveSnapshot(f.scope);
    const save = vi.spyOn(f.store, 'saveTimeline');
    expect(await f.bridge.saveApproved(proposal.proposalId, 'approved')).toMatchObject({ status: 'already-clean', diskMatches: true, uiApplied: true });
    expect(save).not.toHaveBeenCalled();
    expect(f.consumePermit).toHaveBeenCalledOnce();
  });
});

it('does not expose main-process filesystem errors through model or renderer receipts', async () => {
  await withBridge(async f => {
    const proposal = await f.bridge.prepareSaveSnapshot(f.scope);
    vi.spyOn(f.store, 'saveTimeline').mockRejectedValue(new Error('EACCES: /private/user-secret/project.json'));
    const result = await f.bridge.saveApproved(proposal.proposalId, 'approved');
    expect(result).toMatchObject({ status: 'not-written', errorCode: 'CUA_SAVE_FAILED' });
    expect(JSON.stringify(result)).not.toContain('/private');
  });
});
