import { z } from 'zod';
import { createHash } from 'node:crypto';
import { reaGenerationPlanSchema, type ReaGenerationPlan } from '../shared/reaGeneration';

const taskId = z.string().min(1).max(160).regex(/^[\w-]+$/);
const taskSchema = z.object({ id: taskId, model: z.literal('MiniMax-H3'),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  task_type: z.literal('generation'), modality: z.literal('video'),
  resolution: z.literal('768P'), duration: z.number().int().min(4).max(15) });
export interface OfflineVideoTransport {
  readonly kind: 'offline-fixture';
  request(input: { method: 'POST' | 'GET' | 'DELETE'; path: string; body?: string; signal: AbortSignal }): Promise<{ status: number; body: string }>;
}
export type VideoTransport = OfflineVideoTransport | { readonly kind: 'global-payg'; request: OfflineVideoTransport['request'] };
/** Auth remains in the main-only transport; the adapter never accepts a key. */
export class MinimaxVideoAdapter {
  constructor(private readonly transport: VideoTransport, private readonly paidExecutionAllowed = () => false) {}
  get isOfflineFixture() { return this.transport.kind === 'offline-fixture'; }
  private async request(method: 'POST' | 'GET' | 'DELETE', path: string, body?: string): Promise<unknown> {
    if (!this.isOfflineFixture && !this.paidExecutionAllowed()) throw new Error('PAID_EXECUTION_DISABLED');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        this.transport.request({ method, path, ...(body === undefined ? {} : { body }), signal: controller.signal }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('PROVIDER_TIMEOUT')); }, 10000); })
      ]);
      if (response.status !== 200 || Buffer.byteLength(response.body) > 262144) throw new Error('PROVIDER_RESPONSE_REJECTED');
      try { return JSON.parse(response.body); } catch { throw new Error('PROVIDER_SCHEMA_REJECTED'); }
    } finally { if (timer) clearTimeout(timer); }
  }
  async submit(value: ReaGenerationPlan, image?: Uint8Array): Promise<string> {
    const p = reaGenerationPlanSchema.parse(value);
    if (p.referenceImage && (!image || image.byteLength !== p.referenceImage.byteLength || createHash('sha256').update(image).digest('hex') !== p.referenceImage.sha256)) throw new Error('REFERENCE_CHANGED');
    if (!p.referenceImage && image) throw new Error('UNAPPROVED_REFERENCE');
    const content: object[] = [{ type: 'text', text: p.prompt }];
    if (p.referenceImage && image) content.push({ type: 'image_url', image_url: { url: `data:${p.referenceImage.mimeType};base64,${Buffer.from(image).toString('base64')}` }, role: 'first_frame' });
    const response = await this.request('POST', '/v2/video_generation', JSON.stringify({ model: p.model, content, resolution: p.resolution, duration: p.durationSeconds, ratio: p.ratio, generate_audio: false, response_format: 'task' }));
    return z.strictObject({ task_id: taskId }).parse(response).task_id;
  }
  async query(id: string, duration: number) {
    taskId.parse(id);
    const response = z.object({ task: taskSchema }).parse(await this.request('GET', `/v2/query/video_generation/${id}`)).task;
    if (response.id !== id || response.duration !== duration) throw new Error('FOREIGN_TASK');
    // Signed URLs and provider error messages are never returned or persisted here.
    return response.status;
  }
  /** Main-only collector handoff, never an IPC response or persisted receipt. */
  async resultUrl(id: string, duration: number): Promise<string> {
    taskId.parse(id);
    const response = z.object({ task: taskSchema.extend({ content: z.object({ url: z.string().min(1).max(8192) }) }) })
      .parse(await this.request('GET', `/v2/query/video_generation/${id}`)).task;
    if (response.id !== id || response.duration !== duration || response.status !== 'succeeded') throw new Error('RESULT_NOT_READY');
    return response.content.url;
  }
  async cancelQueued(id: string): Promise<'cancelled' | 'deleted'> {
    taskId.parse(id);
    const r = z.strictObject({ task_id: taskId, action: z.enum(['cancelled', 'deleted']), status: z.enum(['cancelled', 'deleted']) }).parse(await this.request('DELETE', `/v2/video_generation/${id}`));
    if (r.task_id !== id || r.action !== r.status) throw new Error('CANCEL_UNCONFIRMED');
    return r.action;
  }
}
