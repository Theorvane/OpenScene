import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Per-provider API key slots. The four legacy LLM slots and the media-provider
 * slots keep their names; every other catalog provider stores under its own
 * provider id (e.g. `openrouter`, `groq`).
 */
export type ProviderCredentials = Record<string, string | undefined>;

export type CredentialStatusMap = Record<string, boolean>;

/** Slots that must always appear in the status map, even before anything is stored. */
const ALWAYS_REPORTED_CREDENTIAL_KEYS = [
  'agentRouterApiKey',
  'openaiApiKey',
  'anthropicApiKey',
  'geminiApiKey',
  'deepseekApiKey',
  'elevenlabsApiKey',
  'runwayApiKey',
  'klingApiKey',
  'lumaApiKey',
  'bytePlusApiKey'
] as const;

export class CredentialStore {
  private readonly filePath: string;
  private memoryCache: ProviderCredentials = {};
  private work: Promise<void> = Promise.resolve();

  constructor(directory: string) {
    this.filePath = join(directory, 'encrypted_credentials.bin');
  }

  private isEncryptionSupported(): boolean {
    return safeStorage !== undefined && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable();
  }

  async getCredentials(): Promise<ProviderCredentials> {
    try {
      const buffer = await readFile(this.filePath);
      if (!this.isEncryptionSupported()) {
        throw new Error('Electron safeStorage encryption is unavailable on this system.');
      }
      const decrypted = safeStorage.decryptString(buffer);
      this.memoryCache = JSON.parse(decrypted) as ProviderCredentials;
      return { ...this.memoryCache };
    } catch (err) {
      if (err instanceof Error && err.message.includes('safeStorage')) {
        throw err;
      }
      return { ...this.memoryCache };
    }
  }

  async getCredentialStatus(): Promise<CredentialStatusMap> {
    const creds = await this.getCredentials();
    const status: Record<string, boolean> = {};
    for (const key of ALWAYS_REPORTED_CREDENTIAL_KEYS) {
      status[key] = false;
    }
    for (const [key, value] of Object.entries(creds)) {
      status[key] = typeof value === 'string' && value.trim().length > 0;
    }
    return status;
  }

  async getCredentialValue(provider: keyof ProviderCredentials): Promise<string | undefined> {
    const creds = await this.getCredentials();
    return creds[provider];
  }

  setCredential(provider: keyof ProviderCredentials, apiKey: string): Promise<void> {
    // The application owns one store. Keep its read/modify/replace operations in
    // invocation order, without allowing one failed save to poison later saves.
    const operation = this.work.then(() => this.saveCredential(provider, apiKey));
    this.work = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async saveCredential(provider: keyof ProviderCredentials, apiKey: string): Promise<void> {
    if (!this.isEncryptionSupported()) {
      throw new Error('Electron safeStorage encryption is unavailable on this system.');
    }

    const current = await this.getCredentials();
    const candidate = { ...current, [provider]: apiKey };
    const outputBuffer = safeStorage.encryptString(JSON.stringify(candidate));
    const directory = join(this.filePath, '..');
    await mkdir(directory, { recursive: true });
    const temporaryPath = join(directory, `.encrypted_credentials.${randomUUID()}.tmp`);
    let temporary: FileHandle | undefined;
    let created = false;
    try {
      // Exclusive creation avoids following an existing path. Only ciphertext is
      // written; replacement also tightens permissions on older POSIX bundles.
      temporary = await open(temporaryPath, 'wx', 0o600);
      created = true;
      await temporary.writeFile(outputBuffer);
      await temporary.sync();
      await temporary.close();
      temporary = undefined;
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      try {
        await temporary?.close();
      } finally {
        if (created) await rm(temporaryPath, { force: true });
      }
      throw error;
    }
    // Reads can continue to return the previous complete bundle until rename.
    // A failed encryption/write/replacement must never publish the candidate.
    this.memoryCache = candidate;
  }
}
