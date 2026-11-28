import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readRepo = (path: string): Promise<string> => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('AI project domain surface parity', () => {
  it('uses one shared document in desktop persistence, preload', async () => {
    const [timelineTypes, projectStore, preload, ipc] = await Promise.all([
      readRepo('src/shared/timelineTypes.ts'),
      readRepo('src/main/projectStore.ts'),
      readRepo('src/preload/index.ts'),
      readRepo('src/shared/ipc.ts'),
    ]);

    expect(timelineTypes).toContain('readonly ai: AiProjectDocument;');
    expect(projectStore).toContain('saveAiProjectDocument(projectId: string, ai: AiProjectDocument');
    expect(preload).toContain('saveAiProjectDocument(input: SaveAiProjectDocumentInput)');
    expect(ipc).toContain("projectAiDocumentSave: 'project-ai-document:save'");
  });

  it('removes Writer from the editing entrance', async () => {
    const [desktop] = await Promise.all([
      readRepo('src/renderer/src/App.tsx'),
    ]);
    expect(desktop).not.toContain('<WriterWorkspace');
  });
});
