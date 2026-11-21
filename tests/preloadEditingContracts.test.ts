import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { IPC_CHANNELS } from '../src/shared/ipc';

it('exposes typed editing and transcription without generation or browser automation', async () => {
  const source = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
  expect(source).toContain('saveTimeline(input: SaveTimelineInput)');
  expect(source).toContain('startTranscription(input: StartTranscriptionInput)');
  for (const key of ['aiGenerateVideo', 'aiGenerateImage', 'aiGenerateSpeech', 'generationSpendGet', 'startBrowserSession', 'writerGenerate']) {
    expect(IPC_CHANNELS).not.toHaveProperty(key);
    expect(source).not.toContain(key);
  }
});
