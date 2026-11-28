import type { ShortsItem, ShortsJob } from './shortsTypes';

export type VideoResult = ShortsItem & { readonly resultProjectId: string; readonly jobId: string };

/** Retry runs share result projects; a failed retry cannot hide a retained successful file. */
export function videoResultsForProject(projectId: string, jobs: readonly ShortsJob[]): readonly VideoResult[] {
  const results = new Map<string, VideoResult>();
  const priority = (item: ShortsItem) => item.status === 'completed' && item.exportJobId ? 2 : item.exportJobId ? 1 : 0;
  for (const job of [...jobs].filter(job => job.sourceProjectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    for (const item of job.items) {
      if (!item.resultProjectId) continue;
      const existing = results.get(item.resultProjectId);
      if (!existing || priority(item) > priority(existing)) results.set(item.resultProjectId, { ...item, resultProjectId: item.resultProjectId, jobId: job.id });
    }
  }
  return [...results.values()];
}
