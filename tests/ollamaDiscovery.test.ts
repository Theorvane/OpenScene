import { expect, it, vi } from 'vitest';
import { discoverOllama, discoveredOllamaModel } from '../src/main/ollamaDiscovery';

it('returns only declared model capabilities and no server modelfile/path fields', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify(String(url).endsWith('/api/tags') ? { models: [{ name: 'team/qwen:tag', details: { quantization_level: 'Q4' } }] } : { capabilities: ['completion', 'tools', 'vision'], model_info: { 'qwen.context_length': 32768 }, modelfile: 'FROM /private/model', secret: 'fixture' })));
  const result = await discoverOllama({ baseUrl: 'http://localhost:11434' }, fetcher as typeof fetch);
  expect(result).toEqual({ ok: true, value: { models: [{ name: 'team/qwen:tag', tools: true, vision: true, contextLength: 32768 }] } });
  expect(fetcher.mock.calls.every(([, options]) => (options as RequestInit | undefined)?.redirect === 'error')).toBe(true);
});
it('refuses credentials/queries and non-http endpoints without making a request', async () => {
  const fetcher = vi.fn();
  for (const baseUrl of ['file:///private/data', 'http://user:password@localhost:11434', 'https://host/?key=secret']) expect(await discoverOllama({ baseUrl }, fetcher)).toMatchObject({ ok: false });
  expect(fetcher).not.toHaveBeenCalled();
});
it('does not invent tool support for older servers or leak their failure body', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify(String(url).endsWith('/api/tags') ? { models: [{ name: 'plain:latest' }] } : { modelfile: '/private/model' })));
  expect(await discoverOllama({ baseUrl: 'http://localhost:11434' }, fetcher as typeof fetch)).toEqual({ ok: true, value: { models: [{ name: 'plain:latest', tools: false, vision: false }] } });
  expect(JSON.stringify(await discoverOllama({ baseUrl: 'http://localhost:11434' }, async () => new Response('/private/failure-secret', { status: 500 })))).not.toContain('failure-secret');
});
it('rejects a late snapshot after a failed refresh and reconnect', async () => {
  let release!: (response: Response) => void;
  const baseUrl = 'http://localhost:11435';
  const late = discoverOllama({ baseUrl }, async url => String(url).endsWith('/api/tags')
    ? new Promise<Response>(resolve => { release = resolve; })
    : new Response(JSON.stringify({ capabilities: ['tools', 'vision'] })));
  await discoverOllama({ baseUrl }, async () => new Response('', { status: 500 }));
  await discoverOllama({ baseUrl }, async () => new Response(JSON.stringify({ models: [] })));
  release(new Response(JSON.stringify({ models: [{ name: 'stale:latest' }] })));
  await late;
  expect(discoveredOllamaModel('local_ollama/stale:latest', baseUrl)).toBeUndefined();
});
