import { createHash, randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { CuaSaveCommitAck, CuaSaveProposal, CuaSaveReadyAck, CuaSaveResult, CuaSaveScope, CuaSaveSnapshotReport } from '../shared/cuaSave';
import type { LocalProjectSnapshot, TimelineDocument } from '../shared/timelineTypes';
import { parseTimelineDocument } from '../shared/timelineValidators';
import { IPC_CHANNELS } from '../shared/ipc';
import type { ProjectStore } from './projectStore';

const ACK_TIMEOUT_MS = 500;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function cuaSaveDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
interface Entry {
  proposal: CuaSaveProposal;
  timeline: TimelineDocument;
  baselineDigest: string;
  cancelled: boolean;
  execution?: { permit: unknown; promise: Promise<CuaSaveResult> };
}
interface Waiter<T> { token: string; entry: Entry; resolve: (value: T | null) => void }
export interface CuaSaveBridgeDependencies {
  readonly projects: ProjectStore;
  readonly assertScope: (scope: CuaSaveScope) => void;
  readonly checkPermit: (proposal: CuaSaveProposal, permit: unknown) => void;
  readonly consumePermit: (proposal: CuaSaveProposal, permit: unknown) => void;
}

/** Main-only immutable snapshot/save lifecycle. Renderer replies never grant authority. */
export class CuaSaveBridge {
  private readonly entries = new Map<string, Entry>();
  private snapshot: { token: string; scope: CuaSaveScope; resolve: (report: CuaSaveSnapshotReport | null) => void } | null = null;
  private ready: Waiter<CuaSaveReadyAck> | null = null;
  private commit: Waiter<CuaSaveCommitAck> | null = null;
  private readonly revokedRuns = new Set<string>();
  private readonly writes = new Set<Promise<CuaSaveResult>>();

  constructor(private readonly window: BrowserWindow, private readonly dependencies: CuaSaveBridgeDependencies) {}
  private emit(channel: string, payload: unknown): void {
    try { if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) this.window.webContents.send(channel, payload); }
    catch { /* Missing acknowledgements time out; completed writes retain their receipt. */ }
  }
  private clearSnapshot(token: string): void { if (this.snapshot?.token === token) this.snapshot = null; }
  private assertScope(scope: CuaSaveScope): void {
    if (!scope || !['projectId', 'sessionId', 'runId', 'frameId'].every(k => typeof scope[k as keyof CuaSaveScope] === 'string' && String(scope[k as keyof CuaSaveScope]).length > 0)
      || !['windowId', 'layoutRevision', 'contentRevision'].every(k => Number.isSafeInteger(scope[k as keyof CuaSaveScope]) && Number(scope[k as keyof CuaSaveScope]) >= 0)
      || scope.windowId !== this.window.id || this.revokedRuns.has(scope.runId)) throw new Error('CUA_SAVE_SCOPE_CHANGED');
    this.dependencies.assertScope(scope);
  }
  private assertEntry(entry: Entry): void {
    if (entry.cancelled) throw new Error('CUA_SAVE_CANCELLED');
    this.assertScope(entry.proposal.scope);
  }
  private async bounded<T>(promise: Promise<T | null>): Promise<T | null> {
    let timeout!: ReturnType<typeof setTimeout>;
    try { return await Promise.race([promise, new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), ACK_TIMEOUT_MS); })]); }
    finally { clearTimeout(timeout); }
  }
  async prepareSaveSnapshot(scope: CuaSaveScope): Promise<CuaSaveProposal> {
    this.assertScope(scope);
    if (this.snapshot || this.ready || this.writes.size) throw new Error('CUA_SAVE_BUSY');
    if (this.entries.size >= 32) throw new Error('CUA_SAVE_BUDGET_EXCEEDED');
    const requestToken = randomUUID();
    const reportPromise = new Promise<CuaSaveSnapshotReport | null>(resolve => { this.snapshot = { token: requestToken, scope: structuredClone(scope), resolve }; });
    this.emit(IPC_CHANNELS.cuaSaveSnapshotRequested, { requestToken, scope });
    let report: CuaSaveSnapshotReport | null;
    try { report = await this.bounded(reportPromise); }
    finally { this.clearSnapshot(requestToken); }
    if (!report) throw new Error('CUA_SAVE_SNAPSHOT_TIMEOUT');
    this.assertScope(scope);
    const timeline = parseTimelineDocument(report.timeline);
    if (!timeline) throw new Error('CUA_SAVE_INVALID_TIMELINE');
    const baseline = await this.dependencies.projects.open(scope.projectId);
    if (!baseline) throw new Error('CUA_SAVE_PROJECT_NOT_FOUND');
    this.assertScope(scope);
    const clipCount = timeline.tracks.reduce((total, track) => total + track.clips.length, 0);
    const proposal: CuaSaveProposal = {
      proposalId: randomUUID(), snapshotId: randomUUID(), timelineDigest: cuaSaveDigest(timeline), scope: structuredClone(scope), dirty: report.dirty,
      clipCount, titleCount: timeline.titles?.length ?? 0,
      summary: `Save the current OpenScene timeline: ${clipCount} clips, ${timeline.titles?.length ?? 0} titles; project ${scope.projectId}, content revision ${scope.contentRevision}.`
    };
    this.entries.set(proposal.proposalId, { proposal: structuredClone(proposal), timeline: structuredClone(timeline), baselineDigest: cuaSaveDigest(baseline), cancelled: false });
    return structuredClone(proposal);
  }
  reportSnapshot(report: CuaSaveSnapshotReport): boolean {
    const pending = this.snapshot;
    if (!report || !pending || report.requestToken !== pending.token || report.runId !== pending.scope.runId
      || report.projectId !== pending.scope.projectId || report.contentRevision !== pending.scope.contentRevision || typeof report.dirty !== 'boolean') return false;
    const timeline = parseTimelineDocument(report.timeline);
    if (!timeline) return false;
    this.assertScope(pending.scope);
    this.snapshot = null; pending.resolve({ ...report, timeline: structuredClone(timeline) }); return true;
  }
  ackReady(ack: CuaSaveReadyAck): boolean {
    const pending = this.ready, proposal = pending?.entry.proposal;
    if (!ack || !pending || !proposal || ack.saveToken !== pending.token || ack.runId !== proposal.scope.runId || ack.projectId !== proposal.scope.projectId
      || ack.contentRevision !== proposal.scope.contentRevision || ack.snapshotId !== proposal.snapshotId || ack.timelineDigest !== proposal.timelineDigest || typeof ack.ready !== 'boolean') return false;
    this.assertEntry(pending.entry);
    this.ready = null; pending.resolve(structuredClone(ack)); return true;
  }
  ackCommit(ack: CuaSaveCommitAck): boolean {
    const pending = this.commit, scope = pending?.entry.proposal.scope;
    if (!ack || !pending || !scope || ack.saveToken !== pending.token || ack.runId !== scope.runId || ack.projectId !== scope.projectId
      || ack.contentRevision !== scope.contentRevision || typeof ack.uiApplied !== 'boolean') return false;
    this.commit = null; pending.resolve(structuredClone(ack)); return true;
  }
  saveApproved(proposalId: string, permit: unknown): Promise<CuaSaveResult> {
    const entry = this.entries.get(proposalId);
    if (!entry) return Promise.reject(new Error('CUA_SAVE_PROPOSAL_NOT_FOUND'));
    if (entry.execution) return entry.execution.permit === permit ? entry.execution.promise : Promise.reject(new Error('CUA_SAVE_ALREADY_EXECUTED'));
    try { this.assertEntry(entry); this.dependencies.checkPermit(entry.proposal, permit); }
    catch (error) { return Promise.reject(error); }
    if (this.ready || this.writes.size) return Promise.reject(new Error('CUA_SAVE_BUSY'));
    // Publish the idempotency record before starting callbacks or async work.
    const promise = Promise.resolve().then(() => this.perform(entry, permit));
    entry.execution = { permit, promise }; this.writes.add(promise);
    void promise.finally(() => this.writes.delete(promise)).catch(() => undefined);
    return promise;
  }
  private async perform(entry: Entry, permit: unknown): Promise<CuaSaveResult> {
    const proposal = entry.proposal, scope = proposal.scope, saveToken = randomUUID();
    let publishStarted = false;
    let persisted: LocalProjectSnapshot | null = null;
    let result: CuaSaveResult = { saveToken, runId: scope.runId, projectId: scope.projectId, snapshotId: proposal.snapshotId, timelineDigest: proposal.timelineDigest,
      expectedContentRevision: scope.contentRevision, persistedUpdatedAt: null, status: 'not-written', diskMatches: null, uiApplied: false, errorCode: null };
    try {
      this.assertEntry(entry);
      const readyPromise = new Promise<CuaSaveReadyAck | null>(resolve => { this.ready = { token: saveToken, entry, resolve }; });
      this.emit(IPC_CHANNELS.cuaSaveRequested, { saveToken, proposal: structuredClone(proposal) });
      const ready = await this.bounded(readyPromise);
      if (this.ready?.token === saveToken) this.ready = null;
      this.assertEntry(entry);
      if (!ready?.ready) throw new Error(ready?.errorCode ?? 'CUA_SAVE_READY_TIMEOUT');
      persisted = await this.dependencies.projects.saveTimeline(scope.projectId, entry.timeline, new Date(), current => {
        // This callback runs after staging and final file-identity checks,
        // directly before rename. It cannot await or extend permit lifetime.
        this.assertEntry(entry);
        if (cuaSaveDigest(current) !== entry.baselineDigest) throw new Error('CUA_SAVE_BASELINE_CHANGED');
        this.dependencies.consumePermit(proposal, permit);
        publishStarted = true;
      });
      result = { ...result, status: entry.cancelled ? 'persisted-after-cancel' : 'persisted', persistedUpdatedAt: persisted.updatedAt };
      try {
        const disk = await this.dependencies.projects.open(scope.projectId);
        result = { ...result, diskMatches: disk !== null && cuaSaveDigest(disk.timeline) === proposal.timelineDigest,
          errorCode: disk === null ? 'CUA_SAVE_READBACK_FAILED' : null };
      } catch { result = { ...result, errorCode: 'CUA_SAVE_READBACK_FAILED' }; }
    } catch (error) {
      result = { ...result, status: persisted ? (entry.cancelled ? 'persisted-after-cancel' : 'persisted') : publishStarted ? 'write-outcome-unknown' : 'not-written',
        persistedUpdatedAt: persisted?.updatedAt ?? null, errorCode: error instanceof Error ? error.message : 'CUA_SAVE_FAILED' };
    } finally { if (this.ready?.token === saveToken) this.ready = null; }
    const written = result.status === 'persisted' || result.status === 'persisted-after-cancel';
    const commitPromise = written ? new Promise<CuaSaveCommitAck | null>(resolve => { this.commit = { token: saveToken, entry, resolve }; }) : null;
    try {
      this.emit(IPC_CHANNELS.cuaSaveFinished, result); // Also releases FE freeze on any failure.
      const ack = commitPromise ? await this.bounded(commitPromise) : null;
      return { ...result, uiApplied: ack?.uiApplied === true };
    } finally { if (this.commit?.token === saveToken) this.commit = null; }
  }
  cancelRun(runId: string): void {
    this.revokedRuns.add(runId);
    for (const entry of this.entries.values()) if (entry.proposal.scope.runId === runId) entry.cancelled = true;
    if (this.snapshot?.scope.runId === runId) { const pending = this.snapshot; this.snapshot = null; pending.resolve(null); }
    if (this.ready?.entry.proposal.scope.runId === runId) { const pending = this.ready; this.ready = null; pending.resolve(null); }
    // An in-flight publication is never relabelled "not written" or abandoned.
  }
  async settleWrites(): Promise<void> { await Promise.allSettled([...this.writes]); }
}
