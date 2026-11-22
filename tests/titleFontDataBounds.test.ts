import { beforeEach, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ open: vi.fn(), stat: vi.fn(), readFile: vi.fn(), candidates: vi.fn() }));
vi.mock('node:fs/promises', () => fs);
vi.mock('../src/shared/titleFont', () => ({ fontCandidates: fs.candidates }));
import { readTitleFontFile } from '../src/main/titleFontData';

beforeEach(() => {
  vi.resetAllMocks();
  fs.candidates.mockReturnValue(['/allowlisted/font.ttc']);
});
function handle(size: number, contents: Buffer, isFile = true) {
  let cursor = 0;
  const file = {
    stat: vi.fn(async () => ({ size, isFile: () => isFile })),
    read: vi.fn(async (buffer: Buffer, offset: number, length: number) => {
      const bytesRead = Math.min(length, size < 100 ? 3 : length, contents.length - cursor);
      contents.copy(buffer, offset, cursor, cursor + bytesRead);
      cursor += bytesRead;
      return { bytesRead, buffer };
    }),
    close: vi.fn(async () => {})
  };
  fs.open.mockResolvedValue(file);
  return file;
}

it('reads short chunks from the statted handle and closes it', async () => {
  const bytes = Buffer.from('ttcf-font');
  const file = handle(bytes.length, bytes);
  expect(await readTitleFontFile({ family: 'korean', weight: 'regular' })).toEqual({ path: '/allowlisted/font.ttc', bytes });
  expect(fs.open).toHaveBeenCalledWith('/allowlisted/font.ttc', 'r');
  expect(file.read).toHaveBeenCalledTimes(4);
  expect(file.close).toHaveBeenCalledOnce();
  expect(fs.readFile).not.toHaveBeenCalled();
});
it.each([64 * 1024 * 1024 + 1, 0])('rejects collection size %s before reading', async size => {
  const file = handle(size, Buffer.alloc(0));
  expect(await readTitleFontFile({ family: 'korean', weight: 'regular' })).toBeNull();
  expect(file.read).not.toHaveBeenCalled();
  expect(file.close).toHaveBeenCalledOnce();
});
it.each([Buffer.from('tt'), Buffer.from('ttcf-extra')])('rejects a file that changes size after stat', async contents => {
  const file = handle(4, contents);
  expect(await readTitleFontFile({ family: 'korean', weight: 'regular' })).toBeNull();
  expect(file.close).toHaveBeenCalledOnce();
  for (const [buffer, offset, length] of file.read.mock.calls) {
    expect(buffer.length).toBe(5);
    expect(offset + length).toBeLessThanOrEqual(5);
  }
});
it('loads a collection above 16 MiB on every platform', async () => {
  const bytes = Buffer.alloc(17 * 1024 * 1024, 7);
  const file = handle(bytes.length, bytes);
  const result = await readTitleFontFile({ family: 'korean', weight: 'regular' });
  expect(result?.bytes.byteLength).toBe(bytes.length);
  expect(Buffer.from(result!.bytes).equals(bytes)).toBe(true);
  expect(file.close).toHaveBeenCalledOnce();
});
it('keeps ordinary font faces limited to 16 MiB', async () => {
  fs.candidates.mockReturnValue(['/allowlisted/font.ttf']);
  const file = handle(16 * 1024 * 1024 + 1, Buffer.alloc(0));
  expect(await readTitleFontFile({ family: 'sans', weight: 'regular' })).toBeNull();
  expect(file.read).not.toHaveBeenCalled();
  expect(file.close).toHaveBeenCalledOnce();
});
it('closes the handle after a read error', async () => {
  const file = handle(4, Buffer.from('ttcf'));
  file.read.mockRejectedValueOnce(new Error('read failed'));
  expect(await readTitleFontFile({ family: 'korean', weight: 'regular' })).toBeNull();
  expect(file.close).toHaveBeenCalledOnce();
});
it('rejects non-files before allocating or reading', async () => {
  const file = handle(4, Buffer.from('ttcf'), false);
  expect(await readTitleFontFile({ family: 'korean', weight: 'regular' })).toBeNull();
  expect(file.read).not.toHaveBeenCalled();
  expect(file.close).toHaveBeenCalledOnce();
});
