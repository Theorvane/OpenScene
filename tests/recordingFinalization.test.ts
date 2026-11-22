import { Writable } from 'node:stream';
import type { WriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => ({ create: undefined as undefined | (() => WriteStream),
  path: '', afterStat: undefined as Promise<void> | undefined, statReached: false,
  statError: undefined as Error | undefined, removeError: undefined as Error | undefined
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, createWriteStream: (...args: Parameters<typeof actual.createWriteStream>) =>
    control.create ? control.create() : actual.createWriteStream(...args) };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const stats = await actual.stat(...args);
      if (args[0] === control.path) {
        control.statReached = true;
        await control.afterStat;
        if (control.statError) throw control.statError;
      }
      return stats;
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (args[0] === control.path && control.removeError) throw control.removeError;
      return actual.rm(...args);
    }
  };
});

import { RecordingFileStore, createRecordingFileName } from '../src/main/recordingStore';

const directories: string[] = [];
const input = { sourceId: 'window:1', sourceName: 'Demo', now: new Date('2026-11-20T00:00:00Z') };
async function fixture(stream?: Writable) {
  const directory = await mkdtemp(join(tmpdir(), 'recording-finalization-'));
  directories.push(directory);
  if (stream) {
    control.create = () => {
      setImmediate(() => stream.emit('open', 42));
      return stream as unknown as WriteStream;
    };
    await writeFile(join(directory, createRecordingFileName(input.sourceName, input.now)), 'partial');
  }
  const store = new RecordingFileStore(directory);
  const session = await store.begin(input);
  control.path = session.outputPath;
  return { store, session };
}

afterEach(async () => {
  control.create = undefined;
  control.path = '';
  control.afterStat = undefined;
  control.statReached = false;
  control.statError = undefined;
  control.removeError = undefined;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('recording finalization ownership', () => {
  it('retains partial bytes after an idle failure until explicit abort removes them', async () => {
    const stream = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const { store, session } = await fixture(stream);
    stream.destroy(new Error('device removed'));
    await new Promise<void>((resolve) => stream.once('close', resolve));
    await expect(store.finalize(session.id, 100)).rejects.toThrow('device removed');
    expect(await readFile(session.outputPath, 'utf8')).toBe('partial');
    expect(store.getResult(session.id)).toBeNull();
    await store.abort(session.id);
    await expect(readFile(session.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await store.abort(session.id);
  });

  it('closes a failed non-auto-destroying writer and retains explicit cleanup', async () => {
    const stream = new Writable({
      autoDestroy: false,
      write(_chunk, _encoding, callback) { callback(new Error('disk full')); }
    });
    const { store, session } = await fixture(stream);
    await expect(store.appendChunk(session.id, 0, new Uint8Array([1]).buffer)).rejects.toThrow('disk full');
    expect(stream.destroyed).toBe(false);
    await expect(store.finalize(session.id, 100)).rejects.toThrow('disk full');
    expect(stream.closed).toBe(true);
    expect(await readFile(session.outputPath, 'utf8')).toBe('partial');
    expect(store.getResult(session.id)).toBeNull();
    await store.abort(session.id);
    await expect(readFile(session.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('allows explicit cleanup after a failed flush without publishing a result', async () => {
    const stream = new Writable({
      write(_chunk, _encoding, callback) { callback(); },
      final(callback) { callback(new Error('flush failed')); }
    });
    const { store, session } = await fixture(stream);
    await expect(store.finalize(session.id, 100)).rejects.toThrow('flush failed');
    expect(await readFile(session.outputPath, 'utf8')).toBe('partial');
    expect(store.getResult(session.id)).toBeNull();
    await store.abort(session.id);
    await expect(readFile(session.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('abort remains effective while finalization waits for queued chunks', async () => {
    let complete: (() => void) | undefined;
    const stream = new Writable({ write(_chunk, _encoding, callback) { complete = callback; } });
    const { store, session } = await fixture(stream);
    const appending = store.appendChunk(session.id, 0, new Uint8Array([1]).buffer);
    // Attach handlers before cancelling a pending write.
    const appendOutcome = appending.then(() => 'completed', () => 'rejected');
    const finalizing = store.finalize(session.id, 100);
    const finalizeOutcome = finalizing.then(() => 'completed', () => 'rejected');
    await vi.waitFor(() => expect(complete).toBeDefined());
    await expect(store.appendChunk(session.id, 1, new ArrayBuffer(0))).rejects.toThrow('not active');
    await expect(store.finalize(session.id, 100)).rejects.toThrow('not active');
    await store.abort(session.id);
    complete!();
    const outcomes = await Promise.all([appendOutcome, finalizeOutcome]);
    expect(stream.destroyed).toBe(true);
    expect(outcomes).toEqual(['rejected', 'rejected']);
    expect(store.getResult(session.id)).toBeNull();
    await expect(readFile(session.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('abort remains terminal while the stream flush is pending', async () => {
    let finishFlush: (() => void) | undefined;
    const stream = new Writable({
      write(_chunk, _encoding, callback) { callback(); },
      final(callback) { finishFlush = callback; }
    });
    const { store, session } = await fixture(stream);
    const outcome = store.finalize(session.id, 100).then(() => 'completed', () => 'rejected');
    await vi.waitFor(() => expect(finishFlush).toBeDefined());
    expect(store.getActiveSession(session.id)).toBeNull();
    await store.abort(session.id);
    finishFlush!();
    expect(await outcome).toBe('rejected');
    expect(store.getResult(session.id)).toBeNull();
    await expect(readFile(session.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not publish stale metadata after abort during stat', async () => {
    const { store, session } = await fixture();
    await store.appendChunk(session.id, 0, new Uint8Array([1]).buffer);
    let release = (): void => undefined;
    control.afterStat = new Promise<void>((resolve) => { release = resolve; });
    const outcome = store.finalize(session.id, 100).then(() => 'completed', () => 'rejected');
    await vi.waitFor(() => expect(control.statReached).toBe(true));
    await store.abort(session.id);
    release();
    expect(await outcome).toBe('rejected');
    expect(store.getResult(session.id)).toBeNull();
    await expect(readFile(session.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves bytes after a metadata failure and allows explicit cleanup', async () => {
    const { store, session } = await fixture();
    await store.appendChunk(session.id, 0, new Uint8Array([1, 2]).buffer);
    control.statError = new Error('metadata unavailable');
    await expect(store.finalize(session.id, 100)).rejects.toThrow('metadata unavailable');
    expect([...await readFile(session.outputPath)]).toEqual([1, 2]);
    expect(store.getResult(session.id)).toBeNull();
    expect(store.getActiveSession(session.id)).toBeNull();
    await expect(store.appendChunk(session.id, 1, new ArrayBuffer(0))).rejects.toThrow('not active');
    await store.abort(session.id);
    await expect(readFile(session.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains cleanup ownership when removal fails, without reopening writes', async () => {
    const { store, session } = await fixture();
    await store.appendChunk(session.id, 0, new Uint8Array([1]).buffer);
    control.removeError = new Error('temporarily locked');
    await expect(store.abort(session.id)).rejects.toThrow('temporarily locked');
    await expect(store.appendChunk(session.id, 1, new ArrayBuffer(0))).rejects.toThrow('not active');
    await expect(store.finalize(session.id, 100)).rejects.toThrow('not active');
    expect([...await readFile(session.outputPath)]).toEqual([1]);
    control.removeError = undefined;
    await store.abort(session.id);
    await expect(readFile(session.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await store.abort(session.id);
  });

  it('keeps successful finalization available and does not discard it on later abort', async () => {
    const { store, session } = await fixture();
    await store.appendChunk(session.id, 0, new Uint8Array([1, 2]).buffer);
    const result = await store.finalize(session.id, 100);
    await store.abort(session.id);
    expect(store.getResult(session.id)).toEqual(result);
    expect([...await readFile(session.outputPath)]).toEqual([1, 2]);
    expect(store.getActiveSession(session.id)).toBeNull();
  });
});
