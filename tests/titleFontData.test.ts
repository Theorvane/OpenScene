import { stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readTitleFontData, readTitleFontFile } from '../src/main/titleFontData';

// This path is the sole allowlisted Korean face on macOS, not a test fixture.
describe.skipIf(process.platform !== 'darwin')('installed macOS Korean title font', () => {
  it.each(['regular', 'bold'] as const)('loads the installed collection for %s titles and preview data', async weight => {
    const path = '/System/Library/Fonts/AppleSDGothicNeo.ttc';
    const info = await stat(path);
    expect(info.isFile()).toBe(true);
    const file = await readTitleFontFile({ family: 'korean', weight });
    expect(file?.path).toBe(path);
    expect(file?.bytes.byteLength).toBe(info.size);
    expect(Buffer.from(file!.bytes.subarray(0, 4)).toString('ascii')).toBe('ttcf');
    const response = await readTitleFontData({ family: 'korean', weight });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);
    expect(Buffer.from(response.value.base64, 'base64').equals(Buffer.from(file!.bytes))).toBe(true);
    expect(response.value).toMatchObject({ family: 'korean', weight });
    expect(response.value).not.toHaveProperty('path');
  });
});

it('rejects user-provided filesystem paths before loading font data', async () => {
  expect(await readTitleFontData({ family: 'korean', weight: 'regular', path: '/private/arbitrary.ttc' }))
    .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});
