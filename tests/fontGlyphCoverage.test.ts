import { describe, expect, it } from 'vitest';
import { unsupportedFontCharacters } from '../src/shared/fontGlyphCoverage';

function fixture(format: 4 | 12): Uint8Array {
  const bytes = new Uint8Array(256), view = new DataView(bytes.buffer);
  const u16 = (at: number, value: number) => view.setUint16(at, value);
  const u32 = (at: number, value: number) => view.setUint32(at, value);
  u32(0, 0x10000); u16(4, 1); u32(12, 0x636d6170); u32(20, 28);
  u16(30, 1); u16(32, 3); u16(34, format === 12 ? 10 : 1); u32(36, 12);
  u16(40, format);
  if (format === 12) { u32(44, 28); u32(52, 1); u32(56, 0xac00); u32(60, 0xac00); u32(64, 1); }
  else { u16(42, 32); u16(46, 4); u16(54, 0xac00); u16(56, 0xffff); u16(60, 0xac00); u16(62, 0xffff); u16(64, (1 - 0xac00) & 0xffff); u16(66, 1); }
  return bytes;
}
describe('font glyph coverage', () => {
  it.each([4, 12] as const)('checks format %i without substituting missing glyphs', format => {
    expect(unsupportedFontCharacters(fixture(format), '가A가\n')).toEqual(['A']);
    expect(unsupportedFontCharacters(fixture(format), '가')).toEqual([]);
    expect(unsupportedFontCharacters(fixture(format), '😀')).toEqual(['😀']);
  });
  it('rejects malformed or unsupported font data', () => {
    expect(unsupportedFontCharacters(new Uint8Array(), 'A')).toBeNull();
    expect(unsupportedFontCharacters(new Uint8Array(64), 'A')).toBeNull();
  });
});
