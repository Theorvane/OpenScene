import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenerationSpendStore } from '../src/main/generationSpendStore';
import {
  createImageGenerationJob, createSpeechGenerationJob, createVideoGenerationJob,
  setAiJobManagerSpendStore
} from '../src/main/aiJobManager';

// If reservation succeeds by mistake, job creation reaches this filesystem seam.
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => { throw new Error('Job creation must not be reached'); }) } }));

describe('the desktop generation boundary with damaged spending history', () => {
  let directory: string;
  let filePath: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'openscene-spend-blocked-'));
    filePath = join(directory, 'generation-spend.json');
    await writeFile(filePath, '{ damaged financial history');
    setAiJobManagerSpendStore(new GenerationSpendStore(filePath));
  });
  afterEach(async () => {
    setAiJobManagerSpendStore(undefined);
    await rm(directory, { recursive: true, force: true });
  });

  it.each([
    ['image', () => createImageGenerationJob({ prompt: 'Synthetic test', modelId: 'gpt-image-1', aspectRatio: '1:1', mode: 'api' })],
    ['video', () => createVideoGenerationJob({ prompt: 'Synthetic test', modelId: 'sora-2', durationSeconds: 4, aspectRatio: '16:9', mode: 'api' })],
    ['speech', () => createSpeechGenerationJob({ script: 'Synthetic test', voiceId: '', modelId: 'eleven_multilingual_v2', acceptUnknownCost: true })]
  ] as const)('blocks %s before creating a job or requesting generation', async (_kind, create) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network must not be reached'));
    try {
      await expect(create()).rejects.toThrow('spending record');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await readFile(filePath, 'utf8')).toBe('{ damaged financial history');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
