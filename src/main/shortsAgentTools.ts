import type { ApiResponse } from '../shared/models';
import type { ShortsJob } from '../shared/shortsTypes';

type JobTools = {
  getShortsJob(input: { jobId: string }): Promise<ApiResponse<ShortsJob>>;
  cancelShortsJob(input: { jobId: string }): Promise<ApiResponse<{ accepted: boolean }>>;
};

export async function runShortsJobTool(tools: JobTools, start: () => Promise<ApiResponse<ShortsJob>>, signal?: AbortSignal): Promise<ApiResponse<ShortsJob>> {
  if (signal?.aborted) return { ok: false, error: { code: 'INVALID_INPUT', message: 'The conversation was cancelled before starting this job.' } };
  return settleShortsJob(tools, await start(), signal);
}

/** Wait inside the approved tool, avoiding repeated model turns for status polling. */
export async function settleShortsJob(tools: JobTools, initial: ApiResponse<ShortsJob>, signal?: AbortSignal, pollMs = 250): Promise<ApiResponse<ShortsJob>> {
  let result = initial;
  const startedAt = Date.now();
  while (result.ok && !result.value.cleanupComplete && result.value.errorCode !== 'interrupted') {
    const jobId = result.value.id;
    if (signal?.aborted) {
      await tools.cancelShortsJob({ jobId });
      return tools.getShortsJob({ jobId });
    }
    // Very long runs retain a durable UI status; never restart or misreport them.
    if (Date.now() - startedAt >= 15 * 60 * 1000) return result;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, pollMs);
      signal?.addEventListener('abort', done, { once: true });
    });
    if (signal?.aborted) continue;
    result = await tools.getShortsJob({ jobId });
  }
  return result;
}
