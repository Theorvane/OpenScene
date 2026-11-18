import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { finished } from 'node:stream/promises';
import type { WriteStream } from 'node:fs';

import type { ChunkAck, RecordingResult, RecordingSession } from '../shared/models';
import { isInsideDirectory } from './projectStoreSupport';

interface ActiveRecording {
  session: RecordingSession;
  stream: WriteStream;
  nextSequence: number;
  totalBytes: number;
  error?: Error;
  work: Promise<void>;
}

export interface BeginRecordingInput {
  sourceId: string;
  sourceName: string;
  now?: Date;
}

export function sanitizeFileSegment(value: string): string {
  const segment = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  return segment.length > 0 ? segment : 'window';
}

export function createRecordingFileName(sourceName: string, now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-${sanitizeFileSegment(sourceName)}.webm`;
}

async function streamFinished(stream: WriteStream): Promise<void> {
  const completion = finished(stream, { cleanup: true });
  stream.end();
  await completion;
}

function assertWritable(recording: ActiveRecording): void {
  if (recording.error) throw recording.error;
  if (recording.stream.destroyed) throw new Error('Recording stream is closed.');
}

function enqueue<T>(recording: ActiveRecording, operation: () => Promise<T>): Promise<T> {
  const result = recording.work.then(operation);
  recording.work = result.then(() => undefined, () => undefined);
  return result;
}

function destroyStream(stream: WriteStream): Promise<void> {
  if (stream.closed) {
    stream.destroy();
    return Promise.resolve();
  }
  return new Promise((resolveClosed) => {
    stream.once('close', resolveClosed);
    stream.destroy();
  });
}

export class RecordingFileStore {
  private readonly activeRecordings = new Map<string, ActiveRecording>();
  private readonly completedRecordings = new Map<string, RecordingResult>();

  constructor(private readonly recordingsDirectory: string) {}

  get directory(): string {
    return this.recordingsDirectory;
  }

  async begin(input: BeginRecordingInput): Promise<RecordingSession> {
    await mkdir(this.recordingsDirectory, { recursive: true });

    const now = input.now ?? new Date();
    const sessionId = randomUUID();
    const outputPath = join(this.recordingsDirectory, createRecordingFileName(input.sourceName, now));
    if (!isInsideDirectory(this.recordingsDirectory, outputPath)) {
      throw new Error('Resolved recording path escaped the recordings directory.');
    }

    const stream = createWriteStream(outputPath, { flags: 'wx' });
    const session: RecordingSession = {
      id: sessionId,
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      status: 'recording',
      startedAt: now.toISOString(),
      outputPath
    };
    const active: ActiveRecording = { session, stream, nextSequence: 0, totalBytes: 0, work: Promise.resolve() };
    // Observe errors even between operations, not only while awaiting an event.
    stream.on('error', (error: Error) => { active.error ??= error; });
    try {
      await once(stream, 'open');
    } catch (error) {
      await destroyStream(stream);
      throw error;
    }
    this.activeRecordings.set(sessionId, active);
    return session;
  }

  async appendChunk(sessionId: string, sequence: number, chunk: ArrayBuffer): Promise<ChunkAck> {
    const activeRecording = this.activeRecordings.get(sessionId);
    if (activeRecording === undefined) {
      throw new Error('Recording session is not active.');
    }

    return enqueue(activeRecording, async () => {
      assertWritable(activeRecording);
      if (sequence !== activeRecording.nextSequence) {
        throw new Error(`Unexpected recording chunk sequence ${sequence}; expected ${activeRecording.nextSequence}.`);
      }

      const bytes = Buffer.from(new Uint8Array(chunk));
      if (bytes.byteLength > 0) {
        // A true write() return only means buffered, not successfully written.
        await new Promise<void>((resolveWritten, rejectWritten) => {
          activeRecording.stream.write(bytes, (error) => {
            if (error) {
              activeRecording.error ??= error;
              rejectWritten(error);
            } else {
              resolveWritten();
            }
          });
        });
      }
      assertWritable(activeRecording);
      activeRecording.nextSequence += 1;
      activeRecording.totalBytes += bytes.byteLength;
      return { sequence, totalBytes: activeRecording.totalBytes };
    });
  }

  async finalize(sessionId: string, durationMs: number, now = new Date()): Promise<RecordingResult> {
    const activeRecording = this.activeRecordings.get(sessionId);
    if (activeRecording === undefined) {
      throw new Error('Recording session is not active.');
    }

    this.activeRecordings.delete(sessionId);
    return enqueue(activeRecording, async () => {
      assertWritable(activeRecording);
      await streamFinished(activeRecording.stream);

      const fileStats = await stat(activeRecording.session.outputPath);
      const result: RecordingResult = {
        sessionId,
        outputPath: activeRecording.session.outputPath,
        fileName: basename(activeRecording.session.outputPath),
        directory: dirname(activeRecording.session.outputPath),
        fileSizeBytes: fileStats.size,
        durationMs,
        createdAt: now.toISOString()
      };

      this.completedRecordings.set(sessionId, result);
      return result;
    });
  }

  async abort(sessionId: string): Promise<void> {
    const activeRecording = this.activeRecordings.get(sessionId);
    if (activeRecording === undefined) {
      return;
    }

    this.activeRecordings.delete(sessionId);
    // A WriteStream can still be opening when the user cancels. Removing its
    // path before the handle closes races with that pending open on Windows:
    // the remove succeeds, then the stream creates an empty file afterward.
    await destroyStream(activeRecording.stream);
    await rm(activeRecording.session.outputPath, { force: true });
  }

  getResult(sessionId: string): RecordingResult | null {
    return this.completedRecordings.get(sessionId) ?? null;
  }

  getActiveSession(sessionId: string): RecordingSession | null {
    return this.activeRecordings.get(sessionId)?.session ?? null;
  }
}
