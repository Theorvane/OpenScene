import { applyEditorOperations } from './editorOperations';
import type { PreparedGenerationImport } from './reaGenerationResults';
import type { LocalProjectSnapshot } from './timelineTypes';

/** Both surfaces can apply the same verified handoff through their history boundary. */
export function applyVerifiedGenerationImport(project: LocalProjectSnapshot, prepared: PreparedGenerationImport) {
  const { result, scope, operations } = prepared, asset = result.asset;
  if (scope.projectId !== project.id || result.projectId !== project.id || scope.jobId !== result.jobId || scope.sourceEpoch !== result.sourceEpoch
    || !project.timeline.tracks.some(t => t.id === scope.trackId && t.kind === 'video') || asset.kind !== 'video' || asset.mimeType !== 'video/mp4'
    || asset.resultOrigin?.kind !== 'ai-generation' || !asset.metadata || asset.metadata.durationMs !== result.durationMs || operations.length !== 1) return null;
  const operation = operations[0];
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return null;
  const op = operation as Record<string, unknown>;
  if (op.action !== 'clip.add' || op.assetId !== asset.id || op.trackId !== scope.trackId || op.startMs !== scope.atMs || op.sourceStartMs !== 0 || op.sourceEndMs !== result.durationMs) return null;
  const existing = project.assets.find(a => a.id === asset.id);
  if (existing && JSON.stringify(existing) !== JSON.stringify(asset)) return null;
  const assets = existing ? project.assets : [...project.assets, asset];
  const applied = applyEditorOperations(project.timeline, operations, assets);
  return applied.success ? { assets, timeline: applied.timeline } : null;
}
