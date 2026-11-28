import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('subtitle delivery surface parity', () => {
  it('keeps the decision shared, the desktop bridge path-free, and the IPC contract validated', async () => {
    const [desktop, main, preload] = await Promise.all([
      source('src/renderer/src/editor/ExportPanel.tsx'),
      source('src/main/exportIpcService.ts'),
      source('src/preload/index.ts'),
    ]);
    expect(desktop).toContain('Burn approved captions into MP4');
    expect(desktop).toContain('SUBTITLE_SIDECAR_FORMATS');
    expect(main).toContain('timelineForSubtitleDelivery(input.project.timeline, delivery)');
    expect(main).toContain('writeExportSubtitleSidecar(this.dependencies.exportsRoot, jobId, prepared.sidecar)');
    expect(preload).not.toContain('subtitleOutputPath');
  });
});
