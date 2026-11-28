import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

/**
 * That a finished export is read back on every surface.
 *
 * The rule lives in the shared core and is tested there. What this pins is the
 * wiring, because the defect being guarded against is not a wrong comparison —
 * it is nobody performing one. A surface that renders a file and reports
 * success without measuring it is exactly the state this came from, and it
 * would pass every other test in the suite.
 */

const readRepo = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('the desktop', () => {
  it('measures the file before the job is called complete', async () => {
    const service = await readRepo('src/main/exportIpcService.ts');
    const measured = service.indexOf('measureExportedFile');
    const completed = service.indexOf('markCompleted');
    expect(measured).toBeGreaterThan(-1);
    expect(measured).toBeLessThan(completed);
    expect(service).toContain('reviewExport(');
  });

  it('promises what it asked FFmpeg for, not what the timeline looked like', async () => {
    const service = await readRepo('src/main/exportIpcService.ts');
    // The frame and rate the graph was compiled with, and the sound the graph
    // actually carries — a timeline can hold an audio clip whose file turned
    // out to have nothing in it.
    expect(service).toContain('hasSound: compiled.hasSound');
    expect(service).toContain('durationMs: compiled.durationMs');
  });
});
