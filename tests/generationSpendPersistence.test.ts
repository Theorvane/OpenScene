import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenerationSpendStore } from '../src/main/generationSpendStore';
import { estimateImageCost } from '../src/shared/mediaGenerationPricing';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename), readFile: vi.fn(actual.readFile) };
});

const estimate = estimateImageCost({ modelId: 'gpt-image-1', imageCount: 1 });
const now = () => new Date('2026-11-18T07:00:00.000Z');
const entry = { id: 'legacy', at: now().toISOString(), kind: 'image', modelId: 'gpt-image-1', basis: '', amountUsd: 1 };

describe('committed desktop spending history', () => {
  let directory: string;
  let filePath: string;
  let store: GenerationSpendStore;
  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'openscene-spend-persistence-'));
    filePath = join(directory, 'generation-spend.json');
    store = new GenerationSpendStore(filePath, now);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it.each([
    '{ truncated', 'null', '[]', '{}', '{"entries":{}}',
    JSON.stringify({ capUsd: '10', entries: [] }),
    JSON.stringify({ capUsd: null, entries: [] }),
    JSON.stringify({ capUsd: 10, entries: [entry, { nonsense: true }] }),
    JSON.stringify({ entries: [{ ...entry, amountUsd: -1 }] }),
    JSON.stringify({ entries: [{ ...entry, at: 'invalid date' }] }),
    JSON.stringify({ entries: [{ ...entry, at: '2026-02-30T00:00:00.000Z' }] })
  ])('refuses malformed history without overwriting it (%#)', async (text) => {
    await fs.writeFile(filePath, text);
    await expect(store.read()).rejects.toThrow('spending record');
    await expect(store.reserve(estimate)).rejects.toThrow('spending record');
    await expect(store.setCap(null)).rejects.toThrow('spending record');
    await expect(store.charge('legacy')).rejects.toThrow('spending record');
    await expect(store.release('legacy')).rejects.toThrow('spending record');
    expect(await fs.readFile(filePath, 'utf8')).toBe(text);
    expect(await fs.readdir(directory)).toEqual(['generation-spend.json']);
  });

  it('does not treat an unreadable file as an unlimited first run and recovers', async () => {
    await store.setCap(1);
    const previous = await fs.readFile(filePath, 'utf8');
    vi.mocked(fs.readFile).mockRejectedValueOnce(Object.assign(new Error('synthetic permission failure'), { code: 'EACCES' }));
    await expect(store.reserve(estimate)).rejects.toThrow('spending record');
    expect(await fs.readFile(filePath, 'utf8')).toBe(previous);
    expect((await store.reserve(estimate)).ok).toBe(true);
  });

  it('counts valid legacy charges against the cap', async () => {
    await fs.writeFile(filePath, JSON.stringify({ capUsd: 1, entries: [entry] }));
    expect((await store.reserve(estimate)).ok).toBe(false);
    expect(await store.monthToDate()).toMatchObject({ amountUsd: 1, entryCount: 1 });
  });

  it.each(['writeFile', 'sync', 'close'] as const)('preserves the committed ledger on %s failure and recovers', async (method) => {
    await store.setCap(1);
    await store.reserve(estimate);
    const previous = await fs.readFile(filePath, 'utf8');
    const actualOpen = vi.mocked(fs.open).getMockImplementation()!;
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const file = await actualOpen(...args);
      if (method === 'writeFile') {
        vi.spyOn(file, method).mockImplementationOnce(async () => {
          await file.write('partial ledger');
          throw new Error('synthetic write failure');
        });
      } else {
        vi.spyOn(file, method).mockRejectedValueOnce(new Error('synthetic filesystem failure'));
      }
      return file;
    });
    await expect(store.reserve(estimate)).rejects.toThrow('synthetic');
    expect(await fs.readFile(filePath, 'utf8')).toBe(previous);
    expect(await new GenerationSpendStore(filePath, now).read()).toEqual(JSON.parse(previous));
    expect(await fs.readdir(directory)).toEqual(['generation-spend.json']);
    expect((await store.reserve(estimate)).ok).toBe(true);
    expect((await store.read()).entries).toHaveLength(2);
  });

  it('preserves the ledger on exclusive-open failure and uses owner-only temporary files', async () => {
    await store.setCap(1);
    const previous = await fs.readFile(filePath, 'utf8');
    vi.mocked(fs.open).mockRejectedValueOnce(Object.assign(new Error('synthetic open failure'), { code: 'EEXIST' }));
    await expect(store.reserve(estimate)).rejects.toThrow('synthetic open failure');
    expect(await fs.readFile(filePath, 'utf8')).toBe(previous);
    expect(await fs.readdir(directory)).toEqual(['generation-spend.json']);
    expect((await store.reserve(estimate)).ok).toBe(true);
    expect(fs.open).toHaveBeenLastCalledWith(expect.stringMatching(/generation-spend\.json\..+\.tmp$/), 'wx', 0o600);
  });

  it('preserves the ledger on rename failure and recovers', async () => {
    await store.setCap(1);
    const previous = await fs.readFile(filePath, 'utf8');
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('synthetic rename failure'));
    await expect(store.setCap(null)).rejects.toThrow('synthetic rename failure');
    expect(await fs.readFile(filePath, 'utf8')).toBe(previous);
    expect(await fs.readdir(directory)).toEqual(['generation-spend.json']);
    await store.setCap(2);
    expect(await store.read()).toEqual({ capUsd: 2, entries: [] });
  });

  it('exposes the old snapshot until replacement and queues later reservations', async () => {
    await store.setCap(0.05);
    const actualRename = vi.mocked(fs.rename).getMockImplementation()!;
    let reached!: () => void;
    let release!: () => void;
    const atRename = new Promise<void>((resolve) => { reached = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fs.rename).mockImplementationOnce(async (...args) => {
      reached();
      await held;
      return actualRename(...args);
    });
    const reserving = store.reserve(estimate);
    try {
      await Promise.race([atRename, reserving]);
      expect(await store.read()).toEqual({ capUsd: 0.05, entries: [] });
      const second = store.reserve(estimate);
      release();
      expect((await reserving).ok).toBe(true);
      expect((await second).ok).toBe(false);
      expect((await store.read()).entries).toHaveLength(1);
    } finally {
      release();
      await reserving;
    }
  });
});
