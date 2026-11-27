import { createHash } from 'node:crypto';
import { z } from 'zod';
import { reaGenerationPlanSchema, type ReaGenerationPlan } from '../shared/reaGeneration';
import type { AssetLibraryStore } from './assetLibraryStore';
import type { ReaGenerationJobStore } from './reaGenerationJobStore';
import { generationPlanHash } from './reaGenerationPlan';
import { runReaProcess } from './reaVideoAnalysisProcess';
import { ffprobePathFor } from './exportMeasurement';

export async function captureGenerationSourceIdentity(assets: Pick<AssetLibraryStore, 'openPlaybackSource'>, ffmpeg: string, plan: ReaGenerationPlan): Promise<string> {
  const source = await assets.openPlaybackSource(plan.projectId, plan.sourceAssetId);
  if (!source) throw new Error('SOURCE_UNAVAILABLE');
  try {
    if (!source.mimeType.startsWith('video/') || source.byteLength > 2_147_483_648) throw new Error('SOURCE_REJECTED');
    const before = await source.file.stat(); const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024), started = Date.now(); let offset = 0;
    while (offset <= source.byteLength) {
      if (Date.now() - started > 15000) throw new Error('SOURCE_TIMEOUT');
      const r = await source.file.read(buffer, 0, Math.min(buffer.length, source.byteLength - offset + 1), offset);
      if (!r.bytesRead) break; offset += r.bytesRead; hash.update(buffer.subarray(0, r.bytesRead));
    }
    if (offset !== source.byteLength) throw new Error('SOURCE_CHANGED');
    const probe = await runReaProcess(ffprobePathFor(ffmpeg), ['-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm,avi,mpegts,flv,ogg', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', source.filePath], new AbortController().signal, 15000);
    const p = z.object({ streams: z.array(z.object({ codec_type: z.string(), width: z.number().optional(), height: z.number().optional() })).max(16), format: z.object({ duration: z.string() }) }).parse(JSON.parse(probe.stdout));
    const durationMs = Math.round(Number(p.format.duration) * 1000), video = p.streams.find(s => s.codec_type === 'video'), after = await source.file.stat();
    if (!Number.isSafeInteger(durationMs) || durationMs < plan.sourceEndMs || durationMs > 600000 || !video?.width || !video.height || video.width > 3840 || video.height > 3840
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('SOURCE_CHANGED');
    hash.update(JSON.stringify([before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs, durationMs])); return hash.digest('hex');
  } finally { await source.file.close(); }
}

export class ReaGenerationSubmission {
  constructor(private readonly allowed: () => boolean, private readonly jobs: ReaGenerationJobStore,
    private readonly capture: (plan: ReaGenerationPlan) => Promise<string>,
    private readonly image: (plan: ReaGenerationPlan) => Promise<Uint8Array | undefined>) {}
  async submit(payload: unknown) {
    // Must precede payload parsing, source reads, approval consumption, keys and HTTP.
    if (!this.allowed()) throw new Error('PAID_EXECUTION_DISABLED');
    const p = z.strictObject({ id: z.string().uuid(), approval: z.string().uuid(), plan: reaGenerationPlanSchema }).parse(payload);
    const approved = await this.jobs.getPlan(p.id, p.plan.projectId);
    if (!p.plan.sourceIdentity || generationPlanHash(approved) !== generationPlanHash(p.plan) || await this.capture(p.plan) !== p.plan.sourceIdentity) throw new Error('SOURCE_CHANGED');
    const bytes = await this.image(p.plan);
    if (p.plan.referenceImage && (!bytes || bytes.length !== p.plan.referenceImage.byteLength || createHash('sha256').update(bytes).digest('hex') !== p.plan.referenceImage.sha256)) throw new Error('REFERENCE_CHANGED');
    if (!this.allowed()) throw new Error('PAID_EXECUTION_DISABLED');
    return this.jobs.submit(p.id, p.approval, p.plan, bytes);
  }
}
