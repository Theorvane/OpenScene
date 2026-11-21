import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => ({ file: undefined as FileHandle | undefined, flags: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (_path: string, flags: number) => {
      control.flags = flags;
      if (!control.file) throw new Error('Missing synthetic handle');
      return control.file;
    }
  };
});

import { VideoJobRecoveryStore } from '../src/main/videoJobRecoveryStore';

const LIMIT = 4 * 1024 * 1024;
const job = {
  id: 'recovery-bound', provider: 'gemini_veo', mode: 'api', status: 'running',
  prompt: '한글 🔒', aspectRatio: '16:9', durationSeconds: 8,
  createdAt: '2026-09-10T05:00:00.000Z', updatedAt: '2026-09-10T05:00:00.000Z'
};
const journal = Buffer.from(JSON.stringify({ schemaVersion: 1, jobs: [job] }));

function fakeFile(bytes: Buffer, options: { size?: number; regular?: boolean; chunk?: number } = {}) {
  let delivered = 0;
  const read = vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
    const count = Math.min(length, options.chunk ?? length, bytes.length - position);
    bytes.copy(buffer, offset, position, position + count);
    delivered += count;
    return { bytesRead: count, buffer };
  });
  const readFile = vi.fn(async () => bytes.toString('utf8'));
  const stat = vi.fn(async () => ({ size: options.size ?? bytes.length, isFile: () => options.regular ?? true }));
  const close = vi.fn(async () => {});
  control.file = { read, readFile, stat, close } as unknown as FileHandle;
  return { read, readFile, stat, close, delivered: () => delivered };
}
const load = () => new VideoJobRecoveryStore('/synthetic/private/jobs.json').load();
afterEach(() => { control.file = undefined; control.flags = 0; });

describe('bounded video-job recovery reads', () => {
  it('opens nonblocking with no-follow and rejects special files without reading', async () => {
    const file = fakeFile(Buffer.alloc(0), { regular: false });
    expect(await load()).toEqual([]);
    expect(control.flags).toBe(constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    expect(file.read).not.toHaveBeenCalled();
    expect(file.readFile).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('bounds a growing file even if the oversized suffix is valid JSON whitespace', async () => {
    const file = fakeFile(Buffer.concat([journal, Buffer.alloc(LIMIT * 2, 32)]), { size: journal.length });
    expect(await load()).toEqual([]);
    expect(file.readFile).not.toHaveBeenCalled();
    expect(file.delivered()).toBe(LIMIT + 1);
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('accepts an exact-limit UTF-8 journal without unbounded reads', async () => {
    const file = fakeFile(Buffer.concat([journal, Buffer.alloc(LIMIT - journal.length, 32)]));
    expect(await load()).toEqual([job]);
    expect(file.readFile).not.toHaveBeenCalled();
    expect(file.delivered()).toBe(LIMIT);
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('handles short reads splitting multibyte UTF-8', async () => {
    const file = fakeFile(journal, { chunk: 1 });
    expect(await load()).toEqual([job]);
    expect(file.readFile).not.toHaveBeenCalled();
    expect(file.read.mock.calls.length).toBe(journal.length + 1);
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('rejects known oversized metadata before reading', async () => {
    const file = fakeFile(journal, { size: LIMIT + 1 });
    expect(await load()).toEqual([]);
    expect(file.read).not.toHaveBeenCalled();
    expect(file.readFile).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledOnce();
  });

  it.each(['stat', 'read'] as const)('closes after %s failure with fail-soft recovery', async (operation) => {
    const file = fakeFile(journal);
    file[operation].mockRejectedValueOnce(new Error('/private/read-failure'));
    expect(await load()).toEqual([]);
    expect(file.close).toHaveBeenCalledOnce();
  });
});
