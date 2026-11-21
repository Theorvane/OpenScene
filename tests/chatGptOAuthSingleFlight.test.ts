import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s).reverse(),
  decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf8')
} }));
import { ChatGptOAuthService } from '../src/main/chatGptOAuthService';
import { ChatGptOAuthTokenStore } from '../src/main/chatGptOAuthTokenStore';
const NOW = 1_800_000_000_000;
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'oauth-single-flight-'));
  await new ChatGptOAuthTokenStore(directory).save({ accessToken: 'old', refreshToken: 'old-refresh', expiresAt: NOW, accountId: 'account' });
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const response = () => new Response(JSON.stringify({ id_token: "h." + Buffer.from(JSON.stringify({ chatgpt_account_id: "account" })).toString("base64url") + ".s", access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600 }), { status: 200 });
it('shares a rotating refresh across concurrent callers and reuses committed tokens', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetchImpl = vi.fn<typeof fetch>(async () => { await gate; return response(); });
  const service = new ChatGptOAuthService(directory, { fetchImpl, now: () => NOW });
  const requests = Array.from({ length: 12 }, () => service.acquireCredentials());
  try {
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  } finally { release(); await Promise.allSettled(requests); }
  expect(await Promise.all(requests)).toEqual(Array.from({ length: 12 }, () => ({ accessToken: 'fresh', accountId: 'account' })));
  await expect(new ChatGptOAuthTokenStore(directory).load()).resolves.toMatchObject({ refreshToken: 'rotated' });
  await service.acquireCredentials();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('clears failed work so callers can retry', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('synthetic failure')).mockImplementation(async () => response());
  const service = new ChatGptOAuthService(directory, { fetchImpl, now: () => NOW });
  const results = await Promise.allSettled([service.acquireCredentials(), service.acquireCredentials()]);
  expect(results.every((r) => r.status === 'rejected')).toBe(true);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  await expect(service.acquireCredentials()).resolves.toMatchObject({ accessToken: 'fresh' });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('does not join an acquisition from a logged-out session', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(async () => { await gate; return response(); }).mockImplementation(async () => response());
  const service = new ChatGptOAuthService(directory, { fetchImpl, now: () => NOW });
  const old = service.acquireCredentials();
  const observed = Promise.allSettled([old]);
  try {
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await service.logout();
    await new ChatGptOAuthTokenStore(directory).save({ accessToken: 'new-session', refreshToken: 'new-refresh', expiresAt: NOW, accountId: 'account' });
    await expect(service.acquireCredentials()).resolves.toMatchObject({ accessToken: 'fresh' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  } finally { release(); }
  expect((await observed)[0]?.status).toBe('rejected');
});
