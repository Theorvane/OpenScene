import { mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TranscriptionService } from '../src/main/transcriptionService';
import { transcribeOpenedAsset } from '../src/main/whisperCppAdapter';
import type { OpenedAssetPlaybackSource } from '../src/main/assetLibraryStore';
import type { MediaAsset } from '../src/shared/timelineTypes';

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const asset: MediaAsset = {
  id: 'audio-1', displayName: 'voice.wav', projectRelativePath: 'assets/voice.wav', kind: 'audio', mimeType: 'audio/wav', byteLength: 3,
  metadata: { durationMs: 2_000 }, createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z'
};
const runtime = { executablePath: 'whisper-cli', modelPath: 'model.bin', executableName: 'whisper-cli', modelName: 'model.bin', version: 'test', checksumVerified: true };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'openscene-cancel-'));
  directories.push(directory);
  const filePath = join(directory, 'voice.wav');
  await writeFile(filePath, Buffer.from([1, 2, 3]));
  const file = await open(filePath, 'r');
  return { directory, source: { file, filePath, mimeType: asset.mimeType, byteLength: 3 } };
}
function dependencies() {
  return {
    getAsset: vi.fn(async () => asset),
    openAsset: vi.fn(async (): Promise<OpenedAssetPlaybackSource | null> => null),
    discoverFfmpeg: vi.fn(async () => ({ kind: 'system' as const, executablePath: 'ffmpeg' })),
    resolveRuntime: vi.fn(async () => ({ status: { ready: true, checksumVerified: true }, runtime })),
    transcribe: vi.fn(async () => [])
  };
}
async function start(service: TranscriptionService) {
  const result = await service.start({ projectId: 'project-1', assetId: 'audio-1', language: 'en' });
  if (!result.ok) throw new Error('start failed');
  return result.value.id;
}

describe('terminal transcription cancellation', () => {
  it('does not start preflight for an already cancelled queued job', async () => {
    vi.useFakeTimers();
    const deps = dependencies();
    const service = new TranscriptionService(deps);
    const id = await start(service);
    service.cancel(id);
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.getAsset).not.toHaveBeenCalled();
    expect(deps.resolveRuntime).not.toHaveBeenCalled();
    expect(deps.openAsset).not.toHaveBeenCalled();
    expect(service.get(id)?.status).toBe('cancelled');
    expect(service.cancel(id)).toEqual({ ok: true, value: { cancelled: false } });
  });

  it.each(['metadata', 'runtime', 'open'] as const)('stops after cancellation during %s and closes acquired files', async (stage) => {
    const { source } = await fixture();
    const closed = vi.spyOn(source.file, 'close');
    const gate = deferred();
    vi.useFakeTimers();
    const deps = dependencies();
    deps.getAsset.mockImplementation(async () => { if (stage === 'metadata') await gate.promise; return asset; });
    deps.resolveRuntime.mockImplementation(async () => { if (stage === 'runtime') await gate.promise; return { status: { ready: true, checksumVerified: true }, runtime }; });
    deps.openAsset.mockImplementation(async () => { if (stage === 'open') await gate.promise; return source; });
    const service = new TranscriptionService(deps);
    const id = await start(service);
    await vi.advanceTimersByTimeAsync(1);
    service.cancel(id);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    if (stage === 'open') await vi.waitFor(() => expect(closed).toHaveBeenCalled());
    await source.file.close();
    if (stage === 'metadata') expect(deps.resolveRuntime).not.toHaveBeenCalled();
    if (stage !== 'open') expect(deps.openAsset).not.toHaveBeenCalled();
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(service.get(id)?.status).toBe('cancelled');
  });

  it.each(['resolve', 'reject'] as const)('ignores late callbacks and %s after cancellation', async (outcome) => {
    const { source } = await fixture();
    const closed = vi.spyOn(source.file, 'close');
    const gate = deferred();
    const deps = dependencies();
    const service = new TranscriptionService({ ...deps, openAsset: async () => source, transcribe: async ({ onStage, onProgress }) => {
      onStage('transcribing'); onProgress(30);
      await gate.promise;
      onStage('normalizing'); onProgress(99);
      if (outcome === 'reject') throw new Error('late failure');
      return [{ id: 'transcript-cue-1', text: 'Late.', startMs: 0, endMs: 1_000 }];
    } });
    const id = await start(service);
    await vi.waitFor(() => expect(service.get(id)?.status).toBe('transcribing'));
    service.cancel(id);
    const cancelled = service.get(id);
    gate.resolve();
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
    expect(service.get(id)).toEqual(cancelled);
    expect(service.cancel(id)).toEqual({ ok: true, value: { cancelled: false } });
  });
});

describe('cancellable whisper source staging', () => {
  it('does not stage or spawn an already aborted request', async () => {
    const { directory, source } = await fixture();
    const controller = new AbortController();
    controller.abort();
    const read = vi.spyOn(source.file, 'createReadStream');
    const spawnProcess = vi.fn(() => { throw new Error('unexpected spawn'); });
    try {
      await expect(transcribeOpenedAsset({ source, sourceFileName: 'voice.wav', ffmpegPath: 'ffmpeg', runtime, language: 'en', signal: controller.signal, temporaryRoot: directory, spawnProcess, onStage: vi.fn(), onProgress: vi.fn() })).rejects.toThrow();
      expect(read).not.toHaveBeenCalled();
      expect(spawnProcess).not.toHaveBeenCalled();
      expect(await readdir(directory)).toEqual(['voice.wav']);
    } finally { await source.file.close(); }
  });

  it('aborts a stalled copy and removes its temporary directory without spawning', async () => {
    const { directory, source } = await fixture();
    const controller = new AbortController();
    const copied = deferred();
    let sent = false;
    const stalled = new Readable({ read() {
      if (sent) return;
      sent = true;
      this.push(Buffer.from([1]));
      copied.resolve();
    } });
    vi.spyOn(source.file, 'createReadStream').mockReturnValue(stalled as ReturnType<typeof source.file.createReadStream>);
    const spawnProcess = vi.fn(() => { throw new Error('unexpected spawn'); });
    const operation = transcribeOpenedAsset({ source, sourceFileName: 'voice.wav', ffmpegPath: 'ffmpeg', runtime, language: 'en', signal: controller.signal, temporaryRoot: directory, spawnProcess, onStage: vi.fn(), onProgress: vi.fn() });
    const rejected = expect(operation).rejects.toThrow();
    await copied.promise;
    controller.abort();
    // Baseline has no signal on pipeline; force it to settle rather than hang the test.
    await Promise.resolve();
    const abortedCopy = stalled.destroyed;
    if (!abortedCopy) stalled.push(null);
    await rejected;
    expect(abortedCopy).toBe(true);
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual(['voice.wav']);
  });
});
