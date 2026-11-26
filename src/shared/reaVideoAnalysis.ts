/** Local measured evidence only. This contract contains no executable or source paths. */
export const REA_ANALYSIS_LIMITS = { durationMs: 600_000, shots: 60, jobs: 8, outputBytes: 262_144, timeoutMs: 120_000 } as const;
export const REA_ANALYSIS_CHANNELS = { runtime: 'rea-analysis:runtime', start: 'rea-analysis:start', get: 'rea-analysis:get', cancel: 'rea-analysis:cancel', prepareImport: 'rea-analysis:prepare-import' } as const;
export type ReaPrepareImportInput = ReaAnalysisInput & { readonly jobId: string; readonly shotIds: readonly string[]; readonly trackId: string; readonly prefix: string; readonly atMs: number };
export type ReaAnalysisInput = { readonly projectId: string; readonly assetId: string };
export type ReaShot = { readonly id: string; readonly sourceStartMs: number; readonly sourceEndMs: number; readonly evidence: 'ffmpeg-scene-change' | 'source-boundary' };
export type ReaPlan = ReaAnalysisInput & {
  readonly version: 1;
  readonly durationMs: number;
  readonly shots: readonly ReaShot[];
  readonly analysis: 'local-measured-timing';
  readonly semantics: 'unavailable';
  readonly generation: 'unavailable-implementation-missing';
  readonly paidExecutionAllowed: false;
};
export type ReaAnalysisJob = ReaAnalysisInput & {
  readonly id: string;
  readonly status: 'running' | 'review' | 'failed' | 'cancelled';
  readonly cleanupComplete: boolean;
  readonly error?: 'runtime-unavailable' | 'invalid-media' | 'resource-limit';
  readonly plan?: ReaPlan;
  readonly videoMd?: string;
};
export type ReaAnalysisRuntime = {
  readonly available: boolean;
  readonly reason?: string;
  readonly upstreamPython: 'not-used-requires-python-3.10-and-separate-dependency-review';
  readonly python?: { readonly status: 'compatible' | 'unavailable'; readonly version?: string };
};
export function parseReaAnalysisInput(value: unknown): ReaAnalysisInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose an imported video.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== 'projectId' && key !== 'assetId') ||
    ![input.projectId, input.assetId].every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))) throw new Error('Choose valid project and asset ids.');
  return { projectId: input.projectId as string, assetId: input.assetId as string };
}
export function measuredReaPlan(input: ReaAnalysisInput, durationMs: number, cuts: readonly number[]): ReaPlan {
  parseReaAnalysisInput(input);
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > REA_ANALYSIS_LIMITS.durationMs) throw new Error('Unsupported duration.');
  const boundaries = [0, ...Array.from(new Set(cuts.filter(ms => Number.isSafeInteger(ms) && ms > 0 && ms < durationMs))).sort((a, b) => a - b), durationMs];
  if (boundaries.length - 1 > REA_ANALYSIS_LIMITS.shots) throw new Error('Too many shots.');
  return { ...input, version: 1, durationMs, analysis: 'local-measured-timing', semantics: 'unavailable', generation: 'unavailable-implementation-missing', paidExecutionAllowed: false,
    shots: boundaries.slice(0, -1).map((start, index) => ({ id: `shot-${index + 1}`, sourceStartMs: start, sourceEndMs: boundaries[index + 1]!, evidence: index === 0 ? 'source-boundary' : 'ffmpeg-scene-change' })) };
}
/** Reviewable Markdown, not a claim of conformance with the full upstream VIDEO.md package. */
export function reaVideoMarkdown(plan: ReaPlan): string {
  return ['# VIDEO.md', '', 'OpenScene local measured shot plan (not a complete upstream VIDEO.md package).',
    'Analysis: FFmpeg scene-change candidates; cuts may be missed or false positives.',
    'Semantic interpretation, ASR and generation: unavailable. No models called; no video generated.',
    'Review each range before importing original source ranges through normal timeline editing.', '',
    '| Shot | Source start (ms) | Source end (ms) | Recreation task |', '| --- | ---: | ---: | --- |',
    ...plan.shots.map(shot => `| ${shot.id} | ${shot.sourceStartMs} | ${shot.sourceEndMs} | Inspect source; describe subject, camera and replacement manually |`), ''].join('\n');
}
/** Feed this batch to the normal editor command/history boundary after explicit review. Never saves. */
export function reaPlanImportOperations(plan: ReaPlan, selectedIds: readonly string[], trackId: string, prefix: string, atMs: number): readonly unknown[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(prefix) || !Number.isSafeInteger(atMs) || atMs < 0) throw new Error('Invalid import placement.');
  const selected = new Set(selectedIds);
  if (!selected.size || selected.size !== selectedIds.length || selectedIds.some(id => !plan.shots.some(shot => shot.id === id))) throw new Error('Select existing shots.');
  return plan.shots.filter(shot => selected.has(shot.id)).map((shot, index) => {
    const startMs = atMs;
    atMs += shot.sourceEndMs - shot.sourceStartMs;
    return { action: 'clip.add', id: `${prefix}-${index + 1}`, assetId: plan.assetId, trackId, startMs, sourceStartMs: shot.sourceStartMs, sourceEndMs: shot.sourceEndMs };
  });
}
