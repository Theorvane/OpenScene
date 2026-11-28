import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AssetLibraryStore } from './assetLibraryStore';
import { downloadGenerationResult, type GenerationDownloadTransport } from './reaGenerationDownload';
import { assembleGenerationReview, verifyGenerationMedia } from './reaGenerationMedia';
import type { ReaGenerationPlan, ReaGenerationReceipt } from '../shared/reaGeneration';
import { generationPlanHash } from './reaGenerationPlan';
import type { GenerationImportScope, PreparedGenerationImport, VerifiedGenerationResult } from '../shared/reaGenerationResults';
import { z } from 'zod';

/** Main-only handoff. URLs/paths never enter public DTOs or diagnostics. */
export class ReaGenerationResultService {
  private readonly results = new Map<string, VerifiedGenerationResult>();
  private readonly active = new Set<string>();
  private readonly retired = new Set<string>();
  constructor(private readonly directory: string, private readonly ffmpeg: () => Promise<string>,
    private readonly assets: Pick<AssetLibraryStore, 'findByResultOrigin' | 'import' | 'updateMetadata' | 'getPlaybackSource'>,
    private readonly transport?: GenerationDownloadTransport) {}
  retire(jobId: string) { this.retired.add(jobId); this.results.delete(jobId); }
  async prepareImport(scope: GenerationImportScope, trackExists: (projectId: string, trackId: string) => Promise<boolean>): Promise<PreparedGenerationImport> {
    const p = z.strictObject({ jobId: z.string().uuid(), projectId: z.string().regex(/^[\w-]{1,160}$/), sourceEpoch: z.string().min(1).max(512),
      trackId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/), atMs: z.number().int().nonnegative().max(86_400_000) }).parse(scope);
    const result = this.get(p.jobId, p.projectId, p.sourceEpoch);
    if (!result || !await trackExists(p.projectId, p.trackId) || !await this.assets.getPlaybackSource(p.projectId, result.asset.id)
      || this.retired.has(p.jobId)) throw new Error('RESULT_IMPORT_UNAVAILABLE');
    return { result, scope: p, operations: [{ action: 'clip.add', id: `rea-generated-${randomUUID()}`, assetId: result.asset.id,
      trackId: p.trackId, startMs: p.atMs, sourceStartMs: 0, sourceEndMs: result.durationMs }] };
  }
  get(jobId: string, projectId: string, sourceEpoch: string): VerifiedGenerationResult | null {
    const r = this.results.get(jobId);
    return r && !this.retired.has(jobId) && r.projectId === projectId && r.sourceEpoch === sourceEpoch ? structuredClone(r) : null;
  }
  async receive(receipt: ReaGenerationReceipt, plan: ReaGenerationPlan, mainOnlyUrl: string, signal: AbortSignal): Promise<VerifiedGenerationResult> {
    if (receipt.state !== 'remote-succeeded' || receipt.planHash !== generationPlanHash(plan) || !receipt.taskId || receipt.cancelRequested || this.retired.has(receipt.id) || this.active.has(receipt.id)) throw new Error('RESULT_NOT_ELIGIBLE');
    this.active.add(receipt.id);
    let temporary: string | undefined;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 }); temporary = await mkdtemp(join(this.directory, 'result-'));
      const path = join(temporary, 'result.mp4');
      await downloadGenerationResult(mainOnlyUrl, path, signal, this.transport);
      const media = await verifyGenerationMedia(await this.ffmpeg(), path, plan.durationSeconds * 1000, signal);
      if (plan.ratio !== 'adaptive') {
        const [width, height] = plan.ratio.split(':').map(Number);
        if (!width || !height || Math.abs(media.width / media.height - width / height) > 0.03) throw new Error('RESULT_RATIO_REJECTED');
      }
      if (signal.aborted || this.retired.has(receipt.id)) throw new Error('RESULT_RETIRED');
      const origin = { kind: 'ai-generation' as const, resultId: receipt.id };
      const existing = await this.assets.findByResultOrigin(plan.projectId, origin);
      const imported = existing ?? await this.assets.import({ projectId: plan.projectId, sourcePath: path, displayName: 'Generated REA shot.mp4', kind: 'video', mimeType: 'video/mp4', resultOrigin: origin });
      const asset = await this.assets.updateMetadata({ projectId: plan.projectId, assetId: imported.id, durationMs: media.durationMs, width: media.width, height: media.height });
      // Cancellation during registration can leave a verified library asset, but never
      // a UI-applicable result. It is not added to a timeline or represented as cancelled remotely.
      if (signal.aborted || this.retired.has(receipt.id)) throw new Error('RESULT_RETIRED');
      const r: VerifiedGenerationResult = { jobId: receipt.id, projectId: plan.projectId, sourceEpoch: plan.sourceEpoch, asset, label: 'generated', durationMs: media.durationMs };
      this.results.set(receipt.id, r); return structuredClone(r);
    } catch { throw new Error('RESULT_VERIFICATION_UNAVAILABLE'); }
    finally { this.active.delete(receipt.id); if (temporary) await rm(temporary, { force: true, recursive: true }); }
  }
  async assemble(jobId: string, projectId: string, sourceEpoch: string, targetDurationMs: number, signal: AbortSignal): Promise<VerifiedGenerationResult> {
    const result = this.get(jobId, projectId, sourceEpoch);
    if (!result || targetDurationMs > result.durationMs || this.active.has(jobId)) throw new Error('ASSEMBLY_UNAVAILABLE');
    this.active.add(jobId); let temporary: string | undefined;
    try {
      const source = await this.assets.getPlaybackSource(projectId, result.asset.id);
      if (!source) throw new Error('RESULT_UNAVAILABLE');
      await mkdir(this.directory, { recursive: true, mode: 0o700 }); temporary = await mkdtemp(join(this.directory, 'assembly-'));
      const path = join(temporary, 'assembly.mp4');
      const media = await assembleGenerationReview(await this.ffmpeg(), source.filePath, path, targetDurationMs, signal);
      if (signal.aborted || this.retired.has(jobId)) throw new Error('RESULT_RETIRED');
      const origin = { kind: 'ai-generation' as const, resultId: `${jobId}-assembly-${targetDurationMs}` };
      const imported = await this.assets.findByResultOrigin(projectId, origin) ?? await this.assets.import({ projectId, sourcePath: path, displayName: 'REA local assembly review.mp4', kind: 'video', mimeType: 'video/mp4', resultOrigin: origin });
      const asset = await this.assets.updateMetadata({ projectId, assetId: imported.id, durationMs: media.durationMs, width: media.width, height: media.height });
      if (signal.aborted || this.retired.has(jobId)) throw new Error('RESULT_RETIRED');
      const assembled = { ...result, asset, label: 'local-render' as const, durationMs: media.durationMs };
      this.results.set(jobId, assembled); return structuredClone(assembled);
    } catch { throw new Error('ASSEMBLY_UNAVAILABLE'); }
    finally { this.active.delete(jobId); if (temporary) await rm(temporary, { recursive: true, force: true }); }
  }
}
