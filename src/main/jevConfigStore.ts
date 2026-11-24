import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_JEV_CONFIG, parseJevConfig, type JevJudgmentConfig } from '../shared/jevConfig';

/** Non-secret config only; never accepts or serializes a credential field. */
export class JevConfigStore {
  private snapshot: Readonly<JevJudgmentConfig> = DEFAULT_JEV_CONFIG;
  private work: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(private readonly directory: string) {
    this.path = join(directory, 'jev-judgment-config.json');
  }

  getSnapshot = (): Readonly<JevJudgmentConfig> => this.snapshot;

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.work.then(operation);
    this.work = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Queue alongside writes so an older load cannot overwrite a newer save. */
  load(): Promise<Readonly<JevJudgmentConfig>> {
    return this.enqueue(async () => {
      let next = DEFAULT_JEV_CONFIG;
      try {
        next = parseJevConfig(JSON.parse(await readFile(this.path, 'utf8'))) ?? DEFAULT_JEV_CONFIG;
      } catch {
        // Missing, unreadable and corrupt config all disable advisory calls.
      }
      this.snapshot = next;
      return next;
    });
  }

  set(value: unknown): Promise<Readonly<JevJudgmentConfig>> {
    const next = parseJevConfig(value);
    if (!next) return Promise.reject(new Error('Invalid Jev configuration.'));
    return this.enqueue(async () => {
      await mkdir(this.directory, { recursive: true });
      const temporaryPath = join(this.directory, `.jev-config.${randomUUID()}.tmp`);
      let file: FileHandle | undefined;
      let created = false;
      try {
        file = await open(temporaryPath, 'wx', 0o600);
        created = true;
        await file.writeFile(JSON.stringify(next), 'utf8');
        await file.sync();
        await file.close();
        file = undefined;
        await rename(temporaryPath, this.path);
      } catch (error) {
        try {
          await file?.close();
        } finally {
          if (created) await rm(temporaryPath, { force: true });
        }
        throw error;
      }
      // Publish only the complete committed configuration, after rename.
      this.snapshot = next;
      return next;
    });
  }
}
