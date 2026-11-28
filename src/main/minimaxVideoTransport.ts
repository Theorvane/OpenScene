import { request } from 'node:https';
import type { OfflineVideoTransport } from './minimaxVideoAdapter';

type WireInput = Parameters<OfflineVideoTransport['request']>[0];
export type VideoHttpsExchange = (input: WireInput & { readonly url: URL; readonly headers: Readonly<Record<string, string>> }) => Promise<{ status: number; body: string }>;
export const exchangeMinimaxVideoHttps: VideoHttpsExchange = input => new Promise((resolve, reject) => {
  const req = request(input.url, { method: input.method, signal: input.signal, agent: false, headers: input.headers, maxHeaderSize: 16384 }, response => {
    const chunks: Buffer[] = []; let length = 0;
    if (response.statusCode !== 200 || response.headers['content-type']?.toLowerCase().split(';')[0]?.trim() !== 'application/json') {
      response.destroy(); reject(new Error('PROVIDER_RESPONSE_REJECTED')); return;
    }
    response.on('data', (chunk: Buffer) => { length += chunk.byteLength; if (length > 262144) { response.destroy(); reject(new Error('PROVIDER_RESPONSE_REJECTED')); } else chunks.push(chunk); });
    response.on('error', () => reject(new Error('PROVIDER_RESPONSE_REJECTED')));
    response.on('end', () => resolve({ status: 200, body: Buffer.concat(chunks).toString('utf8') }));
  });
  const timer = setTimeout(() => req.destroy(new Error('PROVIDER_TIMEOUT')), 10000);
  req.once('close', () => clearTimeout(timer));
  req.once('error', () => reject(new Error('PROVIDER_REQUEST_UNAVAILABLE')));
  if (input.body !== undefined) req.write(input.body); req.end();
});

/** Fixed global PAYG host; lazy secret read occurs only behind the execution gate. */
export class MinimaxPaygVideoTransport {
  readonly kind = 'global-payg' as const;
  constructor(private readonly allowed: () => boolean, private readonly readCredential: () => Promise<string | undefined>, private readonly exchange: VideoHttpsExchange = exchangeMinimaxVideoHttps) {}
  async request(input: WireInput): Promise<{ status: number; body: string }> {
    if (!this.allowed()) throw new Error('PAID_EXECUTION_DISABLED');
    if (!['POST', 'GET', 'DELETE'].includes(input.method) || input.signal.aborted || (input.method === 'POST' ? input.path !== '/v2/video_generation' || !input.body : !new RegExp(`^/v2/${input.method === 'GET' ? 'query/video_generation' : 'video_generation'}/[\\w-]{1,160}$`).test(input.path) || input.body !== undefined)
      || Buffer.byteLength(input.body ?? '') > 7_000_000) throw new Error('PROVIDER_REQUEST_REJECTED');
    const key = await this.readCredential();
    if (!key || key.length > 4096 || /[\r\n\0]/.test(key) || !this.allowed() || input.signal.aborted) throw new Error('PROVIDER_CREDENTIAL_UNAVAILABLE');
    try {
      return await this.exchange({ ...input, url: new URL(input.path, 'https://api.minimax.io'), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' } });
    } catch { throw new Error('PROVIDER_REQUEST_UNAVAILABLE'); }
  }
}
