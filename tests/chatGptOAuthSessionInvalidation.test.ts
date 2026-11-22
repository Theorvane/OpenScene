import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text).reverse(),
    decryptString: (buffer: Buffer) => Buffer.from(buffer).reverse().toString('utf8')
  }
}));

import { CHATGPT_CODEX_DEVICE_AUTH, ChatGptOAuthService } from '../src/main/chatGptOAuthService';
import { ChatGptOAuthTokenStore } from '../src/main/chatGptOAuthTokenStore';

const NOW = 1_800_000_000_000;
const stored = { accessToken: 'old-access', refreshToken: 'old-refresh', accountId: 'old-account', expiresAt: NOW + 1_000 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function response(account = 'refreshed-account') {
  return new Response(JSON.stringify({
    access_token: `header.${Buffer.from(JSON.stringify({ chatgpt_account_id: account })).toString('base64url')}.signature`,
    refresh_token: `${account}-refresh`, expires_in: 3_600
  }), { status: 200 });
}

describe('ChatGPT OAuth session invalidation', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'openscene-oauth-session-')); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

  it('does not resurrect tokens or return credentials when a refresh finishes after logout', async () => {
    const store = new ChatGptOAuthTokenStore(directory);
    await store.save(stored);
    const started = deferred<void>();
    const reply = deferred<Response>();
    const service = new ChatGptOAuthService(directory, {
      now: () => NOW,
      fetchImpl: async () => { started.resolve(); return reply.promise; }
    });
    const result = service.acquireCredentials().then((value) => value, (error: unknown) => error);
    await started.promise;
    await expect(service.logout()).resolves.toEqual({ kind: 'disconnected' });
    reply.resolve(response());
    expect(await result).toMatchObject({ reason: 'not_authenticated' });
    await expect(store.load()).resolves.toBeNull();
    await expect(service.getStatus()).resolves.toEqual({ kind: 'disconnected' });
  });

  it('rejects a stale unexpired load without making a refresh request', async () => {
    const readStarted = deferred<void>();
    const read = deferred<typeof stored>();
    vi.spyOn(ChatGptOAuthTokenStore.prototype, 'load').mockImplementationOnce(async () => {
      readStarted.resolve(); return read.promise;
    });
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new ChatGptOAuthService(directory, { now: () => NOW, fetchImpl });
    const result = service.acquireCredentials().then((value) => value, (error: unknown) => error);
    await readStarted.promise;
    await service.logout();
    read.resolve({ ...stored, expiresAt: NOW + 3_600_000 });
    expect(await result).toMatchObject({ reason: 'not_authenticated' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not return a credential whose in-progress save is followed by logout', async () => {
    const store = new ChatGptOAuthTokenStore(directory);
    await store.save(stored);
    const saveStarted = deferred<void>();
    const unblock = deferred<void>();
    const original = ChatGptOAuthTokenStore.prototype.save;
    vi.spyOn(ChatGptOAuthTokenStore.prototype, 'save').mockImplementationOnce(async function (this: ChatGptOAuthTokenStore, tokens) {
      saveStarted.resolve(); await unblock.promise; await original.call(this, tokens);
    });
    const service = new ChatGptOAuthService(directory, { now: () => NOW, fetchImpl: async () => response() });
    const result = service.acquireCredentials().then((value) => value, (error: unknown) => error);
    await saveStarted.promise;
    const logout = service.logout();
    unblock.resolve();
    await logout;
    expect(await result).toMatchObject({ reason: 'not_authenticated' });
    await expect(store.load()).resolves.toBeNull();
  });

  it.each(['before', 'during'] as const)('does not overwrite a new account with a refresh started %s authorization', async (timing) => {
    const store = new ChatGptOAuthTokenStore(directory);
    await store.save(stored);
    const refreshStarted = deferred<void>();
    const refreshReply = deferred<Response>();
    const newSave = deferred<void>();
    const exchangeReply = deferred<Response>();
    const original = ChatGptOAuthTokenStore.prototype.save;
    vi.spyOn(ChatGptOAuthTokenStore.prototype, 'save').mockImplementation(async function (this: ChatGptOAuthTokenStore, tokens) {
      await original.call(this, tokens);
      if (tokens.accountId === 'new-account') newSave.resolve();
    });
    const service = new ChatGptOAuthService(directory, {
      now: () => NOW,
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url === CHATGPT_CODEX_DEVICE_AUTH.userCodeUrl) return new Response(JSON.stringify({ device_auth_id: 'device', user_code: 'synthetic-code', interval: 0 }));
        if (url === CHATGPT_CODEX_DEVICE_AUTH.tokenPollUrl) return new Response(JSON.stringify({ authorization_code: 'code', code_verifier: 'verifier' }));
        const parameters = new URLSearchParams(String(init?.body));
        if (parameters.get('grant_type') === 'refresh_token') { refreshStarted.resolve(); return refreshReply.promise; }
        return exchangeReply.promise;
      }
    });
    if (timing === 'during') await service.startDeviceAuthorization();
    const result = service.acquireCredentials().then((value) => value, (error: unknown) => error);
    await refreshStarted.promise;
    if (timing === 'before') await service.startDeviceAuthorization();
    exchangeReply.resolve(response('new-account'));
    await newSave.promise;
    refreshReply.resolve(response('old-refreshed-account'));
    expect(await result).toMatchObject({ reason: 'not_authenticated' });
    await expect(store.load()).resolves.toMatchObject({ accountId: 'new-account', refreshToken: 'new-account-refresh' });
    await expect(service.acquireCredentials()).resolves.toMatchObject({ accountId: 'new-account' });
  });

  it('waits for an earlier logout clear before acquiring credentials', async () => {
    const store = new ChatGptOAuthTokenStore(directory);
    await store.save(stored);
    const clearStarted = deferred<void>();
    const unblock = deferred<void>();
    const original = ChatGptOAuthTokenStore.prototype.clear;
    vi.spyOn(ChatGptOAuthTokenStore.prototype, 'clear').mockImplementationOnce(async function (this: ChatGptOAuthTokenStore) {
      clearStarted.resolve(); await unblock.promise; await original.call(this);
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    const service = new ChatGptOAuthService(directory, { now: () => NOW, fetchImpl });
    const logout = service.logout();
    await clearStarted.promise;
    const result = service.acquireCredentials().then((value) => value, (error: unknown) => error);
    unblock.resolve();
    await logout;
    expect(await result).toMatchObject({ reason: 'not_authenticated' });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(store.load()).resolves.toBeNull();
  });

  it('can refresh a new session after an invalidated refresh has been rejected', async () => {
    const store = new ChatGptOAuthTokenStore(directory);
    await store.save(stored);
    const started = deferred<void>();
    const reply = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(async () => { started.resolve(); return reply.promise; }).mockImplementation(async () => response('next-account'));
    const service = new ChatGptOAuthService(directory, { now: () => NOW, fetchImpl });
    const result = service.acquireCredentials().then((value) => value, (error: unknown) => error);
    await started.promise;
    await service.logout();
    reply.resolve(response());
    expect(await result).toMatchObject({ reason: 'not_authenticated' });
    await store.save({ ...stored, accountId: 'next-account' });
    await expect(service.acquireCredentials()).resolves.toMatchObject({ accountId: 'next-account' });
    await expect(store.load()).resolves.toMatchObject({ refreshToken: 'next-account-refresh' });
  });
});
