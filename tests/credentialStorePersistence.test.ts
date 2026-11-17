import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeStorage } from 'electron';
import { CredentialStore } from '../src/main/credentialStore';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    // Synthetic reversible encoding, not an OS encryption test.
    encryptString: vi.fn((text: string) => Buffer.from(text, 'utf8')),
    decryptString: (buffer: Buffer) => buffer.toString('utf8')
  }
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) };
});

describe('CredentialStore committed persistence', () => {
  let directory: string;
  let filePath: string;
  let store: CredentialStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'openscene-credential-persistence-'));
    filePath = join(directory, 'encrypted_credentials.bin');
    store = new CredentialStore(directory);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('retains every provider in parallel saves after reload', async () => {
    await store.setCredential('seed', 'synthetic-seed');
    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      store.setCredential(`provider-${index}`, `synthetic-${index}`)));
    const loaded = await new CredentialStore(directory).getCredentials();
    expect(loaded.seed).toBe('synthetic-seed');
    for (let index = 0; index < 20; index += 1) {
      expect(loaded[`provider-${index}`]).toBe(`synthetic-${index}`);
    }
  });

  it('commits same-provider updates in invocation order', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      store.setCredential('provider', `synthetic-${index}`)));
    expect(await new CredentialStore(directory).getCredentialValue('provider')).toBe('synthetic-19');
  });

  it('leaves the old bundle visible until replacement, with later saves queued', async () => {
    await store.setCredential('seed', 'synthetic-seed');
    const actualRename = vi.mocked(fs.rename).getMockImplementation()!;
    let reached!: () => void;
    const atRename = new Promise<void>((resolve) => { reached = resolve; });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fs.rename).mockImplementationOnce(async (...args) => {
      reached();
      await held;
      return actualRename(...args);
    });
    const first = store.setCredential('first', 'synthetic-first');
    // Baseline never calls rename: the assertion fails without waiting forever.
    await Promise.race([atRename, first]);
    const second = store.setCredential('second', 'synthetic-second');
    try {
      expect(fs.rename).toHaveBeenCalled();
      expect(await new CredentialStore(directory).getCredentials()).toEqual({ seed: 'synthetic-seed' });
      expect(await store.getCredentials()).toEqual({ seed: 'synthetic-seed' });
    } finally {
      release();
      await Promise.all([first, second]);
    }
    expect(await new CredentialStore(directory).getCredentials()).toEqual({
      seed: 'synthetic-seed', first: 'synthetic-first', second: 'synthetic-second'
    });
  });

  it('retains disk/cache and cleans temporary files on rename failure, then recovers', async () => {
    await store.setCredential('seed', 'synthetic-seed');
    const previous = await readFile(filePath);
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('synthetic rename failure'));
    await expect(store.setCredential('failed', 'synthetic-failed')).rejects.toThrow('synthetic rename failure');
    expect(await readFile(filePath)).toEqual(previous);
    expect(await readdir(directory)).toEqual(['encrypted_credentials.bin']);
    // Exercise the in-memory fallback without changing the store's implementation.
    await rm(filePath);
    expect(await store.getCredentials()).toEqual({ seed: 'synthetic-seed' });
    await store.setCredential('recovered', 'synthetic-recovered');
    expect(await new CredentialStore(directory).getCredentials()).toEqual({
      seed: 'synthetic-seed', recovered: 'synthetic-recovered'
    });
  });

  it('retains committed state after a partial temporary write failure', async () => {
    await store.setCredential('seed', 'synthetic-seed');
    const previous = await readFile(filePath);
    const actualOpen = vi.mocked(fs.open).getMockImplementation()!;
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const file = await actualOpen(...args);
      const actualWrite = file.writeFile.bind(file);
      vi.spyOn(file, 'writeFile').mockImplementationOnce(async () => {
        await actualWrite(Buffer.from('partial-synthetic-ciphertext'));
        throw new Error('synthetic disk full');
      });
      return file;
    });
    await expect(store.setCredential('failed', 'synthetic-failed')).rejects.toThrow('synthetic disk full');
    expect(await readFile(filePath)).toEqual(previous);
    expect(await readdir(directory)).toEqual(['encrypted_credentials.bin']);
    await rm(filePath);
    expect(await store.getCredentials()).toEqual({ seed: 'synthetic-seed' });
    await store.setCredential('recovered', 'synthetic-recovered');
    expect(await new CredentialStore(directory).getCredentialValue('recovered')).toBe('synthetic-recovered');
  });

  it('does not publish a candidate when encryption fails and accepts a later save', async () => {
    await store.setCredential('seed', 'synthetic-seed');
    const previous = await readFile(filePath);
    vi.mocked(safeStorage.encryptString).mockImplementationOnce(() => { throw new Error('synthetic encryption failure'); });
    await expect(store.setCredential('failed', 'synthetic-failed')).rejects.toThrow('synthetic encryption failure');
    expect(await readFile(filePath)).toEqual(previous);
    await rm(filePath);
    expect(await store.getCredentials()).toEqual({ seed: 'synthetic-seed' });
    await store.setCredential('recovered', 'synthetic-recovered');
    expect(await new CredentialStore(directory).getCredentials()).not.toHaveProperty('failed');
  });

  it('preserves an exclusively pre-existing temporary path when creation fails', async () => {
    await store.setCredential('seed', 'synthetic-seed');
    const previous = await readFile(filePath);
    const actualWriteFile = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).writeFile;
    vi.mocked(fs.open).mockImplementationOnce(async (path) => {
      await actualWriteFile(path, 'synthetic-pre-existing-file');
      throw Object.assign(new Error('synthetic exclusive creation failure'), { code: 'EEXIST' });
    });
    await expect(store.setCredential('failed', 'synthetic-failed')).rejects.toThrow('synthetic exclusive creation failure');
    expect(await readFile(filePath)).toEqual(previous);
    const files = await readdir(directory);
    const collision = files.find((name) => name.endsWith('.tmp'))!;
    expect(await readFile(join(directory, collision), 'utf8')).toBe('synthetic-pre-existing-file');
    await rm(join(directory, collision));
    await store.setCredential('recovered', 'synthetic-recovered');
    expect(await new CredentialStore(directory).getCredentials()).not.toHaveProperty('failed');
  });

  it('retains the old bundle and removes its temporary file if sync fails', async () => {
    await store.setCredential('seed', 'synthetic-seed');
    const previous = await readFile(filePath);
    const actualOpen = vi.mocked(fs.open).getMockImplementation()!;
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const file = await actualOpen(...args);
      vi.spyOn(file, 'sync').mockRejectedValueOnce(new Error('synthetic sync failure'));
      return file;
    });
    await expect(store.setCredential('failed', 'synthetic-failed')).rejects.toThrow('synthetic sync failure');
    expect(await readFile(filePath)).toEqual(previous);
    expect(await readdir(directory)).toEqual(['encrypted_credentials.bin']);
    await store.setCredential('recovered', 'synthetic-recovered');
    expect(await new CredentialStore(directory).getCredentials()).toEqual({
      seed: 'synthetic-seed', recovered: 'synthetic-recovered'
    });
  });

  it.skipIf(process.platform === 'win32')('creates owner-only bundles and leaves no temporary files', async () => {
    await store.setCredential('provider', 'synthetic-value');
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    await store.setCredential('provider', 'synthetic-replacement');
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(['encrypted_credentials.bin']);
  });
});
