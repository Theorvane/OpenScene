import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGptOAuthTokenStore } from '../src/main/chatGptOAuthTokenStore';

vi.mock('electron', () => ({ safeStorage: {} }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename), unlink: vi.fn(actual.unlink) };
});

const bundle = (suffix: string) => ({
  accessToken: `synthetic-access-${suffix}`, refreshToken: `synthetic-refresh-${suffix}`,
  accountId: 'synthetic-account', expiresAt: 1_800_000_000_000
});
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text).reverse(),
  decryptString: (bytes: Buffer) => Buffer.from(bytes).reverse().toString('utf8')
};

describe('ChatGPT OAuth committed token persistence', () => {
  let directory: string;
  let filePath: string;
  let store: ChatGptOAuthTokenStore;
  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'openscene-oauth-persistence-'));
    filePath = join(directory, 'encrypted_chatgpt_oauth.bin');
    store = new ChatGptOAuthTokenStore(directory, encryption);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it.each(['writeFile', 'sync', 'close'] as const)('preserves committed ciphertext on %s failure and recovers', async (method) => {
    await store.save(bundle('old'));
    const previous = await fs.readFile(filePath);
    const actualOpen = vi.mocked(fs.open).getMockImplementation()!;
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const file = await actualOpen(...args);
      if (method === 'writeFile') {
        vi.spyOn(file, method).mockImplementationOnce(async () => {
          await file.write(Buffer.from('synthetic-partial-ciphertext'));
          throw new Error('synthetic write failure');
        });
      } else {
        vi.spyOn(file, method).mockRejectedValueOnce(new Error('synthetic filesystem failure'));
      }
      return file;
    });
    await expect(store.save(bundle('failed'))).rejects.toThrow('synthetic');
    expect(await fs.readFile(filePath)).toEqual(previous);
    expect(await store.load()).toEqual(bundle('old'));
    expect(await fs.readdir(directory)).toEqual(['encrypted_chatgpt_oauth.bin']);
    await store.save(bundle('recovered'));
    expect(await new ChatGptOAuthTokenStore(directory, encryption).load()).toEqual(bundle('recovered'));
  });

  it('preserves the committed bundle on rename failure and recovers', async () => {
    await store.save(bundle('old'));
    const previous = await fs.readFile(filePath);
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('synthetic rename failure'));
    await expect(store.save(bundle('failed'))).rejects.toThrow('synthetic rename failure');
    expect(await fs.readFile(filePath)).toEqual(previous);
    expect(await fs.readdir(directory)).toEqual(['encrypted_chatgpt_oauth.bin']);
    await store.save(bundle('recovered'));
    expect(await store.load()).toEqual(bundle('recovered'));
  });

  it('exposes only the old bundle during replacement and queues a later clear', async () => {
    await store.save(bundle('old'));
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
    const saving = store.save(bundle('new'));
    await Promise.race([atRename, saving]);
    const clearing = store.clear();
    try {
      expect(fs.rename).toHaveBeenCalled();
      expect(await new ChatGptOAuthTokenStore(directory, encryption).load()).toEqual(bundle('old'));
      expect(fs.unlink).not.toHaveBeenCalled();
    } finally {
      release();
      await Promise.all([saving, clearing]);
    }
    expect(await store.load()).toBeNull();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('queues a save after a held clear', async () => {
    await store.save(bundle('old'));
    const actualUnlink = vi.mocked(fs.unlink).getMockImplementation()!;
    let reached!: () => void;
    let release!: () => void;
    const atUnlink = new Promise<void>((resolve) => { reached = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fs.unlink).mockImplementationOnce(async (...args) => {
      reached();
      await held;
      return actualUnlink(...args);
    });
    const clearing = store.clear();
    await atUnlink;
    const saving = store.save(bundle('new'));
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await store.load()).toEqual(bundle('old'));
    } finally {
      release();
      await Promise.all([clearing, saving]);
    }
    expect(await store.load()).toEqual(bundle('new'));
  });

  it('does not remove a file it failed to create exclusively', async () => {
    await store.save(bundle('old'));
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.open).mockImplementationOnce(async (path) => {
      await actual.writeFile(path, 'synthetic-collision');
      throw Object.assign(new Error('synthetic exclusive creation failure'), { code: 'EEXIST' });
    });
    await expect(store.save(bundle('failed'))).rejects.toThrow('synthetic exclusive creation failure');
    const collision = (await fs.readdir(directory)).find((name) => name.endsWith('.tmp'))!;
    expect(await fs.readFile(join(directory, collision), 'utf8')).toBe('synthetic-collision');
    expect(await store.load()).toEqual(bundle('old'));
  });

  it('recovers after a failed clear without replacing tokens', async () => {
    await store.save(bundle('old'));
    vi.mocked(fs.unlink).mockRejectedValueOnce(new Error('synthetic unlink failure'));
    await expect(store.clear()).rejects.toThrow('Could not remove');
    expect(await store.load()).toEqual(bundle('old'));
    await store.save(bundle('new'));
    expect(await store.load()).toEqual(bundle('new'));
    await store.clear();
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('preserves tokens on validation/encryption failures without poisoning later saves', async () => {
    const adapter = { ...encryption, encryptString: vi.fn(encryption.encryptString) };
    store = new ChatGptOAuthTokenStore(directory, adapter);
    await store.save(bundle('old'));
    adapter.encryptString.mockImplementationOnce(() => { throw new Error('synthetic encryption failure'); });
    await expect(store.save(bundle('failed'))).rejects.toThrow('synthetic encryption failure');
    await expect(store.save({ ...bundle('invalid'), accessToken: '' })).rejects.toThrow();
    const unavailable = new ChatGptOAuthTokenStore(directory, { ...encryption, isEncryptionAvailable: () => false });
    await expect(unavailable.save(bundle('failed'))).rejects.toThrow('safeStorage');
    expect(await store.load()).toEqual(bundle('old'));
    expect(await fs.readdir(directory)).toEqual(['encrypted_chatgpt_oauth.bin']);
    await store.save(bundle('recovered'));
    expect(await store.load()).toEqual(bundle('recovered'));
  });

  it('commits concurrent token saves in invocation order', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.save(bundle(String(index)))));
    expect(await new ChatGptOAuthTokenStore(directory, encryption).load()).toEqual(bundle('19'));
    expect(await fs.readdir(directory)).toEqual(['encrypted_chatgpt_oauth.bin']);
  });

  it('snapshots caller input before queued persistence', async () => {
    const candidate = bundle('original');
    const saving = store.save(candidate);
    candidate.refreshToken = 'synthetic-mutated-by-caller';
    await saving;
    expect(await store.load()).toEqual(bundle('original'));
  });

  it.skipIf(process.platform === 'win32')('creates and replaces bundles with mode 0600 and ciphertext only', async () => {
    await store.save(bundle('old'));
    await fs.chmod(filePath, 0o644);
    await store.save(bundle('new'));
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
    const ciphertext = await fs.readFile(filePath);
    expect(JSON.parse(encryption.decryptString(ciphertext))).toEqual(bundle('new'));
    expect(ciphertext.toString('utf8')).not.toContain('synthetic-refresh-new');
    expect(await fs.readdir(directory)).toEqual(['encrypted_chatgpt_oauth.bin']);
  });
});
