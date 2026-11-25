import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { BrowserWindow } from 'electron';
import type { CuaSaveCommitAck, CuaSaveProposal, CuaSaveReadyAck, CuaSaveResult, CuaSaveScope, CuaSaveSnapshotReport } from '../shared/cuaSave';
import type { LocalProjectSnapshot, TimelineDocument } from '../shared/timelineTypes';
import { parseTimelineDocument } from '../shared/timelineValidators';
import { IPC_CHANNELS } from '../shared/ipc';
import type { ProjectStore } from './projectStore';
import { isCuaSaveErrorCode, normalizeCuaSaveError } from './cuaSaveErrors';

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
  createdAt: number;
  completed: boolean;
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
  readonly isProposalPending?: (proposal: CuaSaveProposal) => boolean;
}

/** Main-only immutable snapshot/save lifecycle. Renderer replies never grant authority. */
export class CuaSaveBridge {
  private readonly entries = new Map<string, Entry>();
  private snapshot: { token: string; scope: CuaSaveScope; resolve: (report: CuaSaveSnapshotReport | null) => void } | null = null;
  private ready: Waiter<CuaSaveReadyAck> | null = null;
  private commit: Waiter<CuaSaveCommitAck> | null = null;
  private readonly revokedRuns = new Set<string>();
  private readonly writes = new Set<Promise<CuaSaveResult>>();
  private preparingScope: CuaSaveScope | null = null;

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
    try { this.dependencies.assertScope(scope); } catch (error) { throw new Error(normalizeCuaSaveError(error)); }
  }
  private assertEntry(entry: Entry): void {
    if (entry.cancelled) throw new Error('CUA_SAVE_CANCELLED');
    if (performance.now() - entry.createdAt >= 120000) throw new Error('CUA_SAVE_PROPOSAL_EXPIRED');
    this.assertScope(entry.proposal.scope);
  }
  private prune(): void {
    for (const [id, entry] of this.entries) {
      if ((entry.execution && !entry.completed) || this.dependencies.isProposalPending?.(entry.proposal)) continue;
      let inactive = false;
      try { this.dependencies.assertScope(entry.proposal.scope); } catch { inactive = true; }
      if (inactive || entry.cancelled || performance.now() - entry.createdAt >= 120000) this.entries.delete(id);
    }
    const activeRuns = new Set([...this.entries.values()].map(entry => entry.proposal.scope.runId));
    if (this.snapshot) activeRuns.add(this.snapshot.scope.runId);
    if (this.preparingScope) activeRuns.add(this.preparingScope.runId);
    if (this.ready) activeRuns.add(this.ready.entry.proposal.scope.runId);
    if (this.commit) activeRuns.add(this.commit.entry.proposal.scope.runId);
    for (const runId of this.revokedRuns) if (!activeRuns.has(runId)) this.revokedRuns.delete(runId);
  }
  /** Denied, unissued proposals can release immutable bytes immediately. */
  discardProposal(proposalId: string): boolean {
    const entry = this.entries.get(proposalId);
    if (!entry || (entry.execution && !entry.completed) || this.dependencies.isProposalPending?.(entry.proposal)) return false;
    this.entries.delete(proposalId); this.prune(); return true;
  }
  private async bounded<T>(promise: Promise<T | null>): Promise<T | null> {
    let timeout!: ReturnType<typeof setTimeout>;
    try { return await Promise.race([promise, new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), ACK_TIMEOUT_MS); })]); }
    finally { clearTimeout(timeout); }
  }
  async prepareSaveSnapshot(scope: CuaSaveScope): Promise<CuaSaveProposal> {
    this.prune();
    this.assertScope(scope);
    if (this.preparingScope || this.snapshot || this.ready || this.writes.size) throw new Error('CUA_SAVE_BUSY');
    if (this.entries.size >= 32) throw new Error('CUA_SAVE_BUDGET_EXCEEDED');
    this.preparingScope = structuredClone(scope);
    try {
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
    this.entries.set(proposal.proposalId, { createdAt: performance.now(), completed: false, proposal: structuredClone(proposal), timeline: structuredClone(timeline), baselineDigest: cuaSaveDigest(baseline), cancelled: false });
    return structuredClone(proposal);
    } catch (error) { throw new Error(normalizeCuaSaveError(error)); }
    finally { this.preparingScope = null; this.prune(); }
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
      || ack.contentRevision !== proposal.scope.contentRevision || ack.snapshotId !== proposal.snapshotId || ack.timelineDigest !== proposal.timelineDigest || typeof ack.ready !== 'boolean'
      || (ack.errorCode !== undefined && !isCuaSaveErrorCode(ack.errorCode))) return false;
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
    catch (error) { return Promise.reject(new Error(normalizeCuaSaveError(error))); }
    if (this.ready || this.writes.size) return Promise.reject(new Error('CUA_SAVE_BUSY'));
    // Publish the idempotency record before starting callbacks or async work.
    const promise = Promise.resolve().then(() => this.perform(entry, permit));
    entry.execution = { permit, promise }; this.writes.add(promise);
    void promise.finally(() => { entry.completed = true; this.writes.delete(promise); this.prune(); }).catch(() => undefined);
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
      if (!ready?.ready) throw new Error(ready ? ready.errorCode ?? 'CUA_SAVE_RENDERER_NOT_READY' : 'CUA_SAVE_READY_TIMEOUT');
      const diskBefore = await this.dependencies.projects.open(scope.projectId);
      this.assertEntry(entry);
      if (!diskBefore || cuaSaveDigest(diskBefore) !== entry.baselineDigest) throw new Error('CUA_SAVE_BASELINE_CHANGED');
      const alreadyClean = !proposal.dirty && cuaSaveDigest(diskBefore.timeline) === proposal.timelineDigest;
      if (alreadyClean) {
        this.dependencies.consumePermit(proposal, permit);
        persisted = diskBefore;
      } else persisted = await this.dependencies.projects.saveTimeline(scope.projectId, entry.timeline, new Date(), current => {
        // This callback runs after staging and final file-identity checks,
        // directly before rename. It cannot await or extend permit lifetime.
        this.assertEntry(entry);
        if (cuaSaveDigest(current) !== entry.baselineDigest) throw new Error('CUA_SAVE_BASELINE_CHANGED');
        this.dependencies.consumePermit(proposal, permit);
        publishStarted = true;
      });
      result = { ...result, status: alreadyClean ? 'already-clean' : entry.cancelled ? 'persisted-after-cancel' : 'persisted', persistedUpdatedAt: persisted.updatedAt };
      try {
        const disk = await this.dependencies.projects.open(scope.projectId);
        result = { ...result, diskMatches: disk !== null && cuaSaveDigest(disk.timeline) === proposal.timelineDigest,
          errorCode: disk === null ? 'CUA_SAVE_READBACK_FAILED' : null };
      } catch { result = { ...result, errorCode: 'CUA_SAVE_READBACK_FAILED' }; }
    } catch (error) {
      result = { ...result, status: persisted ? (entry.cancelled ? 'persisted-after-cancel' : 'persisted') : publishStarted ? 'write-outcome-unknown' : 'not-written',
        persistedUpdatedAt: persisted?.updatedAt ?? null, errorCode: normalizeCuaSaveError(error) };
    } finally { if (this.ready?.token === saveToken) this.ready = null; }
    const written = result.status === 'persisted' || result.status === 'persisted-after-cancel' || result.status === 'already-clean';
    const commitPromise = written ? new Promise<CuaSaveCommitAck | null>(resolve => { this.commit = { token: saveToken, entry, resolve }; }) : null;
    try {
      this.emit(IPC_CHANNELS.cuaSaveFinished, result); // Also releases FE freeze on any failure.
      const ack = commitPromise ? await this.bounded(commitPromise) : null;
      return { ...result, uiApplied: ack?.uiApplied === true };
    } finally { if (this.commit?.token === saveToken) this.commit = null; }
  }
  cancelRun(runId: string): void {
    const relevant = this.preparingScope?.runId === runId || this.snapshot?.scope.runId === runId || this.ready?.entry.proposal.scope.runId === runId
      || [...this.entries.values()].some(entry => entry.proposal.scope.runId === runId);
    if (relevant) this.revokedRuns.add(runId);
    for (const entry of this.entries.values()) if (entry.proposal.scope.runId === runId) entry.cancelled = true;
    if (this.snapshot?.scope.runId === runId) { const pending = this.snapshot; this.snapshot = null; pending.resolve(null); }
    if (this.ready?.entry.proposal.scope.runId === runId) { const pending = this.ready; this.ready = null; pending.resolve(null); }
    // An in-flight publication is never relabelled "not written" or abandoned.
    this.prune();
  }
  async settleWrites(): Promise<void> { await Promise.allSettled([...this.writes]); }
}
