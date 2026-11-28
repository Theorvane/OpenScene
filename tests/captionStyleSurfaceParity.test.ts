import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('Caption Studio surface parity', () => {
  it('passes the shared materialized style through previews and every final renderer', async () => {
    const [desktopPreview, ffmpeg] = await Promise.all([
      source('src/renderer/src/editor/ProgramMonitor.tsx'),
      source('src/shared/ffmpegTimelineCompiler.ts'),
    ]);
    expect(desktopPreview).toContain('resolvedTitleStyle(title)');
    expect(desktopPreview).toContain('WebkitTextStroke');
    expect(ffmpeg).toContain('titleOutputPosition(title, frame)');
    expect(ffmpeg).toContain('boxborderw=');
  });

  it('exposes batch styling on the desktop editor and keeps custom font upload out of the contract', async () => {
    const [desktop, shared] = await Promise.all([
      source('src/renderer/src/editor/TypographyInspector.tsx'),
      source('src/shared/captionStyle.ts')
    ]);
    expect(desktop).toContain('Apply appearance to');
    expect(shared).toContain('applyTitleAppearanceToAutomaticCaptions');
    expect(shared).not.toContain('fontPath');
  });
});
