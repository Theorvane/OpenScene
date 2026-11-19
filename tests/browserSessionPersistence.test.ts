import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserSessionVault } from '../src/main/browserSessionVault';

vi.mock('electron', () => ({ safeStorage: {} }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename), unlink: vi.fn(actual.unlink), writeFile: vi.fn(actual.writeFile) };
});

const bundle = (suffix: string) => ({
  version: 1 as const, providerId: 'gemini' as const, storedAt: '2026-09-02T10:00:00.000Z',
  cookies: [{ name: '__Secure-session', value: `synthetic-cookie-${suffix}`, domain: '.google.com',
    hostOnly: false, path: '/', secure: true, httpOnly: true, session: true,
    sameSite: 'lax' as const, sourceUrl: 'https://gemini.google.com' }]
});
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text).reverse(),
  decryptString: (bytes: Buffer) => Buffer.from(bytes).reverse().toString('utf8')
};

describe('Browser session committed cookie persistence', () => {
  let directory: string;
  let filePath: string;
  let store: BrowserSessionVault;
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(fs.open).mockReset().mockImplementation(actual.open);
    vi.mocked(fs.rename).mockReset().mockImplementation(actual.rename);
    vi.mocked(fs.unlink).mockReset().mockImplementation(actual.unlink);
    vi.mocked(fs.writeFile).mockReset().mockImplementation(actual.writeFile);
    directory = await fs.mkdtemp(join(tmpdir(), 'openscene-browser-persistence-'));
    filePath = join(directory, 'encrypted_browser_session_gemini.bin');
    store = new BrowserSessionVault(directory, encryption);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('keeps committed bytes readable while a partial replacement write is held', async () => {
    await store.save(bundle('old'));
    const previous = await fs.readFile(filePath);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let reached!: () => void;
    let release!: () => void;
    const atWrite = new Promise<void>((resolve) => { reached = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    // Exercise the same partial-write boundary on both the baseline direct
    // writeFile and the replacement FileHandle implementation.
    vi.mocked(fs.writeFile).mockImplementationOnce(async (path, data) => {
      await actual.writeFile(path, 'synthetic-partial-ciphertext');
      reached();
      await held;
      return actual.writeFile(path, data);
    });
    const actualOpen = vi.mocked(fs.open).getMockImplementation()!;
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const file = await actualOpen(...args);
      vi.spyOn(file, 'writeFile').mockImplementationOnce(async () => {
        const bytes = encryption.encryptString(JSON.stringify(bundle('new')));
        await file.write(bytes.subarray(0, 12));
        reached();
        await held;
        await file.writeFile(bytes.subarray(12));
      });
      return file;
    });
    const saving = store.save(bundle('new'));
    await atWrite;
    try {
      expect(await fs.readFile(filePath)).toEqual(previous);
      expect(await new BrowserSessionVault(directory, encryption).loadSecret('gemini')).toEqual(bundle('old'));
    } finally {
      release();
      await saving;
    }
    expect(await store.loadSecret('gemini')).toEqual(bundle('new'));
  });

  it('does not start a second save before the first replacement settles', async () => {
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
    const first = store.save(bundle('first'));
    await Promise.race([atRename, first]);
    const second = store.save(bundle('second'));
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fs.open).toHaveBeenCalledTimes(1);
      expect(fs.rename).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await Promise.all([first, second]);
    }
    expect(await store.loadSecret('gemini')).toEqual(bundle('second'));
  });

  it('preserves independent provider slots across saves and clear', async () => {
    const grok = { ...bundle('grok'), providerId: 'grok' as const,
      cookies: bundle('grok').cookies.map((cookie) => ({ ...cookie, domain: '.x.ai', sourceUrl: 'https://grok.com' })) };
    await Promise.all([store.save(bundle('gemini')), store.save(grok)]);
    expect(await store.loadSecret('grok')).toEqual(grok);
    await store.clear('gemini');
    expect(await store.loadSecret('gemini')).toBeNull();
    expect(await new BrowserSessionVault(directory, encryption).loadSecret('grok')).toEqual(grok);
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
    expect(await store.loadSecret('gemini')).toEqual(bundle('old'));
    expect(await fs.readdir(directory)).toEqual(['encrypted_browser_session_gemini.bin']);
    await store.save(bundle('recovered'));
    expect(await new BrowserSessionVault(directory, encryption).loadSecret('gemini')).toEqual(bundle('recovered'));
  });

  it('preserves the committed bundle on rename failure and recovers', async () => {
    await store.save(bundle('old'));
    const previous = await fs.readFile(filePath);
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('synthetic rename failure'));
    await expect(store.save(bundle('failed'))).rejects.toThrow('synthetic rename failure');
    expect(await fs.readFile(filePath)).toEqual(previous);
    expect(await fs.readdir(directory)).toEqual(['encrypted_browser_session_gemini.bin']);
    await store.save(bundle('recovered'));
    expect(await store.loadSecret('gemini')).toEqual(bundle('recovered'));
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
    const clearing = store.clear('gemini');
    try {
      expect(fs.rename).toHaveBeenCalled();
      expect(await new BrowserSessionVault(directory, encryption).loadSecret('gemini')).toEqual(bundle('old'));
      expect(fs.unlink).not.toHaveBeenCalled();
    } finally {
      release();
      await Promise.all([saving, clearing]);
    }
    expect(await store.loadSecret('gemini')).toBeNull();
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
    const clearing = store.clear('gemini');
    await atUnlink;
    const saving = store.save(bundle('new'));
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await store.loadSecret('gemini')).toEqual(bundle('old'));
    } finally {
      release();
      await Promise.all([clearing, saving]);
    }
    expect(await store.loadSecret('gemini')).toEqual(bundle('new'));
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
    expect(await store.loadSecret('gemini')).toEqual(bundle('old'));
  });

  it('recovers after a failed clear without replacing cookies', async () => {
    await store.save(bundle('old'));
    vi.mocked(fs.unlink).mockRejectedValueOnce(new Error('synthetic unlink failure'));
    await expect(store.clear('gemini')).rejects.toThrow('Could not remove');
    expect(await store.loadSecret('gemini')).toEqual(bundle('old'));
    await store.save(bundle('new'));
    expect(await store.loadSecret('gemini')).toEqual(bundle('new'));
    await store.clear('gemini');
    await store.clear('gemini');
    expect(await store.loadSecret('gemini')).toBeNull();
  });

  it('preserves cookies on validation/encryption failures without poisoning later saves', async () => {
    const adapter = { ...encryption, encryptString: vi.fn(encryption.encryptString) };
    store = new BrowserSessionVault(directory, adapter);
    await store.save(bundle('old'));
    adapter.encryptString.mockImplementationOnce(() => { throw new Error('synthetic encryption failure'); });
    await expect(store.save(bundle('failed'))).rejects.toThrow('synthetic encryption failure');
    await expect(store.save({ ...bundle('invalid'), cookies: [] })).rejects.toThrow();
    const unavailable = new BrowserSessionVault(directory, { ...encryption, isEncryptionAvailable: () => false });
    await expect(unavailable.save(bundle('failed'))).rejects.toThrow('safeStorage');
    expect(await store.loadSecret('gemini')).toEqual(bundle('old'));
    expect(await fs.readdir(directory)).toEqual(['encrypted_browser_session_gemini.bin']);
    await store.save(bundle('recovered'));
    expect(await store.loadSecret('gemini')).toEqual(bundle('recovered'));
  });

  it('commits concurrent cookie saves in invocation order', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.save(bundle(String(index)))));
    expect(await new BrowserSessionVault(directory, encryption).loadSecret('gemini')).toEqual(bundle('19'));
    expect(await fs.readdir(directory)).toEqual(['encrypted_browser_session_gemini.bin']);
  });

  it('snapshots caller input before queued persistence', async () => {
    const candidate = bundle('original');
    const saving = store.save(candidate);
    candidate.cookies[0]!.value = 'synthetic-mutated-by-caller';
    await saving;
    expect(await store.loadSecret('gemini')).toEqual(bundle('original'));
  });

  it.skipIf(process.platform === 'win32')('creates and replaces bundles with mode 0600 and ciphertext only', async () => {
    await store.save(bundle('old'));
    await fs.chmod(filePath, 0o644);
    await store.save(bundle('new'));
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
    const ciphertext = await fs.readFile(filePath);
    expect(JSON.parse(encryption.decryptString(ciphertext))).toEqual(bundle('new'));
    expect(ciphertext.toString('utf8')).not.toContain('synthetic-cookie-new');
    expect(await fs.readdir(directory)).toEqual(['encrypted_browser_session_gemini.bin']);
  });
});
