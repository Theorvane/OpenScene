import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { open, rm } from 'node:fs/promises';

// Public primary-documentation examples establish this exact hostname only.
// Unknown result CDNs fail closed until independently reviewed; no wildcard.
const OFFICIAL_CDN = 'cdn.hailuoai.com';
const MAX_BYTES = 100_000_000;
export function generationResultUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== OFFICIAL_CDN || url.port || url.username || url.password || url.hash || value.length > 8192) throw new Error('RESULT_URL_REJECTED');
  return url;
}
export function publicGenerationAddress(address: string): boolean {
  // IPv6 is deliberately unsupported rather than accepting an incomplete special-use list.
  if (isIP(address) !== 4) return false;
  const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99)
    || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
    || a === 203 && b === 0 && c === 113);
}
export interface GenerationDownloadTransport {
  resolve(hostname: string): Promise<readonly string[]>;
  open(url: URL, pinnedAddress: string, signal: AbortSignal): Promise<{
    readonly status: number; readonly mimeType: string; readonly contentLength: number | null;
    readonly remoteAddress: string; readonly body: AsyncIterable<Uint8Array>;
    readonly close: () => void;
  }>;
}
/** Main-only, no authentication header ever. DNS result is pinned into TLS lookup. */
export const officialGenerationDownloadTransport: GenerationDownloadTransport = {
  resolve: async hostname => (await lookup(hostname, { all: true })).map(x => x.address),
  open: (url, pinnedAddress, signal) => new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET', agent: false, signal, headers: { Accept: 'video/mp4', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, options, callback) => {
        // Node autoSelectFamily requests all:true and requires an address array.
        // Both forms return only the already validated, pinned IPv4 address.
        if (options.all) callback(null, [{ address: pinnedAddress, family: 4 }]);
        else callback(null, pinnedAddress, 4);
      }
    }, response => {
      resolve({ status: response.statusCode ?? 0, mimeType: response.headers['content-type'] ?? '',
        contentLength: response.headers['content-length'] === undefined ? null : Number(response.headers['content-length']),
        remoteAddress: response.socket.remoteAddress ?? '', body: response, close: () => response.destroy() });
    });
    req.setTimeout(10000, () => req.destroy(new Error('RESULT_TIMEOUT')));
    req.on('error', () => reject(new Error('RESULT_DOWNLOAD_FAILED'))); req.end();
  })
};

export async function downloadGenerationResult(rawUrl: string, destination: string, signal: AbortSignal,
  transport: GenerationDownloadTransport = officialGenerationDownloadTransport): Promise<number> {
  const controller = new AbortController();
  const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, 60000);
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let response: Awaited<ReturnType<GenerationDownloadTransport['open']>> | undefined;
  let created = false;
  const bounded = async <T>(promise: Promise<T>): Promise<T> => {
    let stop: () => void = () => {};
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        stop = () => reject(new Error('RESULT_ABORTED'));
        if (controller.signal.aborted) stop(); else controller.signal.addEventListener('abort', stop, { once: true });
      })]);
    } finally { controller.signal.removeEventListener('abort', stop); }
  };
  try {
    const url = generationResultUrl(rawUrl);
    const addresses = await bounded(transport.resolve(url.hostname));
    const selected = addresses[0];
    if (!selected || !addresses.every(publicGenerationAddress)) throw new Error('RESULT_DNS_REJECTED');
    const opening = transport.open(url, selected, controller.signal);
    // A non-cooperative injected transport cannot leak a late response/socket.
    void opening.then(value => { if (controller.signal.aborted) value.close(); }, () => undefined);
    response = await bounded(opening);
    if (response.status !== 200 || response.remoteAddress !== selected
      || response.mimeType.toLowerCase().split(';')[0]?.trim() !== 'video/mp4'
      || response.contentLength !== null && (!Number.isSafeInteger(response.contentLength) || response.contentLength < 1 || response.contentLength > MAX_BYTES)) throw new Error('RESULT_RESPONSE_REJECTED');
    file = await open(destination, 'wx', 0o600); created = true;
    let bytes = 0;
    const iterator = response.body[Symbol.asyncIterator]();
    for (;;) {
      const chunk = await bounded(iterator.next());
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES || controller.signal.aborted) throw new Error('RESULT_SIZE_REJECTED');
      // FileHandle.write may be partial. writeFile handles the entire byte sequence.
      await file.writeFile(chunk.value);
    }
    if (!bytes || response.contentLength !== null && bytes !== response.contentLength) throw new Error('RESULT_TRUNCATED');
    await file.sync(); await file.close(); file = undefined;
    return bytes;
  } catch {
    await file?.close().catch(() => undefined);
    if (created) await rm(destination, { force: true });
    // Never expose a signed URL, path, resolver error, or provider message.
    throw new Error('RESULT_DOWNLOAD_REJECTED');
  } finally {
    controller.abort(); response?.close(); clearTimeout(timer); signal.removeEventListener('abort', abort);
  }
}
