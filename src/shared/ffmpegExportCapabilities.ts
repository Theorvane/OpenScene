/** Check only explicit encoders selected by the real saved-timeline compiler. */
export function missingFfmpegEncoders(args: readonly string[], listing: string): readonly string[] {
  const available = new Set(listing.split('\n').flatMap(line => {
    const match = /^\s*[VAS][A-Z.]{5}\s+(\S+)/.exec(line);
    return match ? [match[1]!] : [];
  }));
  return [...new Set(args.flatMap((arg, index) => (arg === '-c:v' || arg === '-c:a') && args[index + 1] !== undefined ? [args[index + 1]!] : []))]
    .filter(encoder => encoder !== 'copy' && !available.has(encoder));
}
