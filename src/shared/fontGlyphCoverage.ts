/** Read Unicode cmap coverage; do not let browser fallback conceal missing export glyphs. */
export function unsupportedFontCharacters(bytes: Uint8Array, text: string): readonly string[] | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (at: number) => view.getUint16(at);
    const u32 = (at: number) => view.getUint32(at);
    const base = u32(0) === 0x74746366 ? u32(12) : 0;
    const count = u16(base + 4);
    if (count > 256) return null;
    let cmap = -1;
    for (let index = 0; index < count; index++) {
      const at = base + 12 + index * 16;
      if (u32(at) === 0x636d6170) cmap = u32(at + 8);
    }
    if (cmap < 0 || u16(cmap + 2) > 256) return null;
    let selected = -1, format = 0;
    for (let index = 0; index < u16(cmap + 2); index++) {
      const at = cmap + 4 + index * 8, platform = u16(at), encoding = u16(at + 2);
      if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
      const table = cmap + u32(at + 4), candidate = u16(table);
      if ((candidate === 4 || candidate === 12) && candidate > format) { selected = table; format = candidate; }
    }
    if (selected < 0) return null;
    const hasGlyph = (code: number): boolean => {
      if (format === 12) {
        const groups = u32(selected + 12);
        if (groups > 1_000_000) throw new Error('Invalid font groups.');
        let low = 0, high = groups - 1;
        while (low <= high) {
          const mid = (low + high) >>> 1, at = selected + 16 + mid * 12;
          if (code < u32(at)) high = mid - 1;
          else if (code > u32(at + 4)) low = mid + 1;
          else return u32(at + 8) + code - u32(at) !== 0;
        }
        return false;
      }
      if (code > 0xffff) return false;
      const segments = u16(selected + 6) / 2;
      if (segments > 8192) throw new Error('Invalid font segments.');
      let low = 0, high = segments - 1;
      while (low < high) { const mid = (low + high) >>> 1; if (u16(selected + 14 + mid * 2) < code) low = mid + 1; else high = mid; }
      const start = selected + 16 + segments * 2, deltas = start + segments * 2, ranges = deltas + segments * 2;
      if (code < u16(start + low * 2) || code > u16(selected + 14 + low * 2)) return false;
      const delta = u16(deltas + low * 2), range = u16(ranges + low * 2);
      if (range === 0) return ((code + delta) & 0xffff) !== 0;
      const glyph = u16(ranges + low * 2 + range + 2 * (code - u16(start + low * 2)));
      return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
    };
    return [...new Set([...text])].filter(character => !/[\r\n\t]/.test(character) && !hasGlyph(character.codePointAt(0)!));
  } catch { return null; }
}
