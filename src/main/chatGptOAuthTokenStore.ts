import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const tokenBundleSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
  accountId: z.string().min(1)
}).strict();

type ChatGptOAuthTokenBundle = z.infer<typeof tokenBundleSchema>;

export type SafeStorageAdapter = {
  readonly isEncryptionAvailable: () => boolean;
  readonly encryptString: (plaintext: string) => Buffer;
  readonly decryptString: (encrypted: Buffer) => string;
};

export class ChatGptOAuthTokenStoreError extends Error {
  override readonly name = 'ChatGptOAuthTokenStoreError';
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export class ChatGptOAuthTokenStore {
  private readonly directory: string;
  private readonly filePath: string;
  private readonly encryption: SafeStorageAdapter;
  private work: Promise<void> = Promise.resolve();

  constructor(directory: string, encryption: SafeStorageAdapter = safeStorage) {
    this.directory = directory;
    this.filePath = join(directory, 'encrypted_chatgpt_oauth.bin');
    this.encryption = encryption;
  }

  async load(): Promise<ChatGptOAuthTokenBundle | null> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw new ChatGptOAuthTokenStoreError('Could not read encrypted ChatGPT OAuth credentials.', { cause: error });
    }

    this.requireEncryption();
    try {
      const payload: unknown = JSON.parse(this.encryption.decryptString(encrypted));
      return tokenBundleSchema.parse(payload);
    } catch (error) {
      throw new ChatGptOAuthTokenStoreError('Encrypted ChatGPT OAuth credentials were invalid.', { cause: error });
    }
  }

  async save(bundle: ChatGptOAuthTokenBundle): Promise<void> {
    // Capture a validated snapshot before deferring work to the mutation queue.
    const validated = tokenBundleSchema.parse(bundle);
    return this.enqueue(async () => {
      this.requireEncryption();
      const encrypted = this.encryption.encryptString(JSON.stringify(validated));
      await mkdir(this.directory, { recursive: true });
      const temporaryPath = join(this.directory, `.encrypted_chatgpt_oauth.${randomUUID()}.tmp`);
      let temporary: FileHandle | undefined;
      let created = false;
      try {
        // Only ciphertext is written. Exclusive creation avoids following or
        // removing a pre-existing file; rename publishes one complete bundle.
        temporary = await open(temporaryPath, 'wx', 0o600);
        created = true;
        await temporary.writeFile(encrypted);
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
    });
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      try {
        await unlink(this.filePath);
      } catch (error) {
        if (!isMissingFile(error)) {
          throw new ChatGptOAuthTokenStoreError('Could not remove ChatGPT OAuth credentials.', { cause: error });
        }
      }
    });
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    // The service owns a single store. A failed mutation must not poison later
    // saves/clears, nor may an earlier save resurrect tokens after a later clear.
    const operation = this.work.then(action);
    this.work = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private requireEncryption(): void {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new ChatGptOAuthTokenStoreError('Electron safeStorage encryption is unavailable on this system.');
    }
  }
}
