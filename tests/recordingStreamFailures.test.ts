import { Writable } from 'node:stream';
import type { WriteStream } from 'node:fs';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => ({ create: undefined as undefined | (() => WriteStream) }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, createWriteStream: (...args: Parameters<typeof actual.createWriteStream>) =>
    control.create ? control.create() : actual.createWriteStream(...args) };
});

import { RecordingFileStore, createRecordingFileName } from '../src/main/recordingStore';

const directories: string[] = [];
async function makeStore() {
  const directory = await mkdtemp(join(tmpdir(), 'recording-errors-'));
  directories.push(directory);
  return { directory, store: new RecordingFileStore(directory) };
}
function fakeStream(write: (callback: (error?: Error | null) => void) => void) {
  const stream = new Writable({ write(_chunk, _encoding, callback) { write(callback); } });
  // Isolate assertions from the runner's uncaught-error handler on the baseline.
  // Production must add its own listener in addition to this test observer.
  stream.on('error', () => undefined);
  control.create = () => {
    setImmediate(() => stream.emit('open', 42));
    return stream as unknown as WriteStream;
  };
  return stream;
}
const input = { sourceId: 'window:1', sourceName: 'Demo', now: new Date('2026-11-19T00:00:00Z') };

afterEach(async () => {
  control.create = undefined;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('recording stream failure handling', () => {
  it('waits for exclusive open and rejects collisions without changing existing bytes', async () => {
    const { directory, store } = await makeStore();
    const path = join(directory, createRecordingFileName(input.sourceName, input.now));
    await writeFile(path, 'existing recording');
    await expect(store.begin(input)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(path, 'utf8')).toBe('existing recording');
  });

  it('does not publish a session until the stream opens', async () => {
    const { store } = await makeStore();
    const stream = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    control.create = () => stream as unknown as WriteStream;
    let settled = false;
    const beginning = store.begin(input).then((session) => { settled = true; return session; });
    await vi.waitFor(() => expect(stream.listenerCount('open')).toBeGreaterThan(0));
    expect(settled).toBe(false);
    stream.emit('open', 42);
    const session = await beginning;
    await store.abort(session.id);
  });

  it('rejects a delayed small write instead of acknowledging queued bytes', async () => {
    const { store } = await makeStore();
    let complete: ((error?: Error | null) => void) | undefined;
    const stream = fakeStream((callback) => { complete = callback; });
    const session = await store.begin(input);
    expect(stream.listenerCount('error')).toBeGreaterThan(1);
    let acknowledged = false;
    const append = store.appendChunk(session.id, 0, new Uint8Array([1]).buffer)
      .then((ack) => { acknowledged = true; return ack; });
    const rejection = expect(append).rejects.toThrow('disk full');
    await vi.waitFor(() => expect(complete).toBeDefined());
    expect(acknowledged).toBe(false);
    complete!(new Error('disk full'));
    await rejection;
    await store.abort(session.id);
  });

  it('remembers an idle error so later empty append and finalize reject promptly', async () => {
    const { store } = await makeStore();
    const stream = fakeStream((callback) => callback());
    const session = await store.begin(input);
    stream.destroy(new Error('device removed'));
    await new Promise<void>((resolve) => stream.once('close', resolve));
    await expect(store.appendChunk(session.id, 0, new ArrayBuffer(0))).rejects.toThrow('device removed');
    await expect(store.finalize(session.id, 10)).rejects.toThrow('device removed');
    expect(store.getResult(session.id)).toBeNull();
  });

  it('does not accumulate drain/error listeners after repeated successful writes', async () => {
    const { store } = await makeStore();
    const stream = fakeStream((callback) => setImmediate(callback));
    const session = await store.begin(input);
    const errorListeners = stream.listenerCount('error');
    for (let index = 0; index < 30; index += 1) {
      await expect(store.appendChunk(session.id, index, new Uint8Array(32_768).buffer))
        .resolves.toEqual({ sequence: index, totalBytes: (index + 1) * 32_768 });
      expect(stream.listenerCount('error')).toBe(errorListeners);
      expect(stream.listenerCount('drain')).toBe(0);
    }
    await store.abort(session.id);
  });
  it('serializes queued chunks and rejects duplicates without poisoning subsequent writes', async () => {
    const { store } = await makeStore();
    fakeStream((callback) => setImmediate(callback));
    const session = await store.begin(input);
    const first = store.appendChunk(session.id, 0, new Uint8Array([1]).buffer);
    const duplicate = store.appendChunk(session.id, 0, new Uint8Array([9]).buffer);
    const second = store.appendChunk(session.id, 1, new Uint8Array([2]).buffer);
    const duplicateRejection = expect(duplicate).rejects.toThrow('Unexpected recording chunk sequence');
    await expect(first).resolves.toEqual({ sequence: 0, totalBytes: 1 });
    await duplicateRejection;
    await expect(second).resolves.toEqual({ sequence: 1, totalBytes: 2 });
    await store.abort(session.id);
  });

  it('waits for queued chunks before finalizing a real file', async () => {
    const { store } = await makeStore();
    const session = await store.begin(input);
    const first = store.appendChunk(session.id, 0, new Uint8Array([1]).buffer);
    const second = store.appendChunk(session.id, 1, new Uint8Array([2]).buffer);
    const finalizing = store.finalize(session.id, 100);
    await expect(first).resolves.toEqual({ sequence: 0, totalBytes: 1 });
    await expect(second).resolves.toEqual({ sequence: 1, totalBytes: 2 });
    const result = await finalizing;
    expect(result.fileSizeBytes).toBe(2);
    expect([...await readFile(result.outputPath)]).toEqual([1, 2]);
    await expect(store.appendChunk(session.id, 2, new ArrayBuffer(0))).rejects.toThrow('not active');
  });

  it('rejects finalize after an idle stream error without requiring an append first', async () => {
    const { store } = await makeStore();
    const stream = fakeStream((callback) => callback());
    const session = await store.begin(input);
    stream.destroy(new Error('idle failure'));
    await new Promise<void>((resolve) => stream.once('close', resolve));
    await expect(store.finalize(session.id, 100)).rejects.toThrow('idle failure');
    expect(store.getResult(session.id)).toBeNull();
  });

  it('rejects finalization errors rather than publishing a completed recording', async () => {
    const { store } = await makeStore();
    const stream = fakeStream((callback) => callback());
    stream._final = (callback) => setImmediate(() => callback(new Error('flush failed')));
    const session = await store.begin(input);
    await expect(store.finalize(session.id, 100)).rejects.toThrow('flush failed');
    expect(store.getResult(session.id)).toBeNull();
  });

  it('aborts immediately after begin and leaves no partial file', async () => {
    const { store } = await makeStore();
    const session = await store.begin(input);
    await store.abort(session.id);
    await expect(readFile(session.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(store.getActiveSession(session.id)).toBeNull();
    await store.abort(session.id);
  });

});
