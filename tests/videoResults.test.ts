import { expect, it } from 'vitest';
import { videoResultsForProject } from '../src/shared/videoResults';
import type { ShortsJob } from '../src/shared/shortsTypes';

const run = (id: string, items: ShortsJob['items'], sourceProjectId = 'source'): ShortsJob => ({ id, items, sourceProjectId, sourceAssetId: 'asset', stage: 'completed', cleanupComplete: true, createdAt: id, updatedAt: id });
it('scopes and deduplicates projects, preserving a completed export when a later retry fails', () => {
  const result = videoResultsForProject('source', [
    run('3', [{ candidateId: 'a', resultProjectId: 'short', status: 'failed', exportJobId: 'failed-export' }]),
    run('2', [{ candidateId: 'a', resultProjectId: 'short', status: 'completed', exportJobId: 'good-export' }]),
    run('1', [{ candidateId: 'a', resultProjectId: 'short', status: 'ready' }]),
    run('4', [{ candidateId: 'b', resultProjectId: 'foreign', status: 'completed' }], 'other')
  ]);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ resultProjectId: 'short', exportJobId: 'good-export', status: 'completed' });
});
it('does not mark an editable project or unfinished export as a finished video', () => {
  expect(videoResultsForProject('source', [run('1', [{ candidateId: 'a', resultProjectId: 'short', status: 'ready' }])])[0]?.status).toBe('ready');
  expect(videoResultsForProject('source', [run('1', [{ candidateId: 'a', status: 'failed' }])])).toEqual([]);
});
