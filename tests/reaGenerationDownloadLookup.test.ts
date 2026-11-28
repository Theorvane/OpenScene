import { describe, expect, it, vi } from 'vitest';
import { BlockList, Socket, getDefaultAutoSelectFamily, type LookupFunction } from 'node:net';
import type { RequestOptions } from 'node:https';
import { EventEmitter } from 'node:events';
import { officialGenerationDownloadTransport } from '../src/main/reaGenerationDownload';

const capture = vi.hoisted(() => ({ options: undefined as RequestOptions | undefined }));
// Capture the production HTTPS options without creating a request or socket.
vi.mock('node:https', () => ({ request: vi.fn((_url, options) => {
  capture.options = options;
  return Object.assign(new EventEmitter(), { setTimeout() {}, end() {} });
}) }));

describe('production pinned DNS callback with real Node socket preparation', () => {
  it.each([undefined, true, false])('supports autoSelectFamily=%s without any network dial', async autoSelectFamily => {
    void officialGenerationDownloadTransport.open(new URL('https://cdn.hailuoai.com/result.mp4'), '93.184.216.34', new AbortController().signal);
    const options = capture.options!;
    expect(options.headers).toEqual({ Accept: 'video/mp4', 'Accept-Encoding': 'identity' });
    expect(options.agent).toBe(false);
    const lookup = options.lookup as LookupFunction;
    const seen: boolean[] = [];
    const blocked = new BlockList();
    blocked.addSubnet('0.0.0.0', 0, 'ipv4');
    blocked.addSubnet('::', 0, 'ipv6');
    const socket = new Socket({ blockList: blocked });
    const error = await new Promise<NodeJS.ErrnoException>(resolve => {
      socket.once('error', resolve);
      socket.connect({ host: 'cdn.hailuoai.com', port: 443, autoSelectFamily,
        lookup: (host, requested, callback) => { seen.push(requested.all === true); lookup(host, requested, callback); } });
    });
    socket.destroy();
    expect(seen).toEqual([autoSelectFamily ?? getDefaultAutoSelectFamily()]);
    // BlockList rejects before connect; a malformed all:true result fails earlier
    // with ERR_INVALID_IP_ADDRESS instead. No external connection can be made.
    expect(error.code).toBe('ERR_IP_BLOCKED');
  });
});
