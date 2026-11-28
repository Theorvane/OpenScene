import { isPlainRecord } from '../shared/timelineValidationPrimitives';
import { isOllamaModelName, normalizeOllamaEndpoint, ollamaNativeModelId, type OllamaDiscovery, type OllamaDiscoveredModel } from '../shared/ollamaModels';
import type { ApiResponse } from '../shared/models';
import { fail, ok } from './ipcResponses';

const snapshots = new Map<string, OllamaDiscovery>();
const generations = new Map<string, number>();
let nextGeneration = 0;
async function json(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) { await response.body?.cancel().catch(() => undefined); throw new Error('Unavailable'); }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 2 * 1024 * 1024) throw new Error('Response too large');
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => undefined); }
}
export async function discoverOllama(payload: unknown, fetcher: typeof fetch = fetch): Promise<ApiResponse<OllamaDiscovery>> {
  const baseUrl = isPlainRecord(payload) && Object.keys(payload).every(key => key === 'baseUrl') ? normalizeOllamaEndpoint(payload.baseUrl) : null;
  if (!baseUrl) return fail('INVALID_INPUT', 'Enter an HTTP(S) Ollama endpoint without embedded credentials, query or fragment.');
  const generation = ++nextGeneration; generations.set(baseUrl, generation);
  const signal = AbortSignal.timeout(10_000);
  try {
    const tags = await json(await fetcher(`${baseUrl}/api/tags`, { redirect: 'error', signal }));
    if (!isPlainRecord(tags) || !Array.isArray(tags.models) || tags.models.length > 128) throw new Error('Invalid model list');
    const names = [...new Set(tags.models.map(item => isPlainRecord(item) && typeof item.name === 'string' && isOllamaModelName(item.name) ? item.name : null))];
    if (names.includes(null)) throw new Error('Invalid model name');
    const models: OllamaDiscoveredModel[] = [];
    for (let offset = 0; offset < names.length; offset += 4) {
      const batch = await Promise.all(names.slice(offset, offset + 4).map(async name => {
        const show = await json(await fetcher(`${baseUrl}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name }), redirect: 'error', signal }));
        if (!isPlainRecord(show)) throw new Error('Invalid model metadata');
        const capabilities = Array.isArray(show.capabilities) ? show.capabilities : [];
        const length = isPlainRecord(show.model_info) ? Object.entries(show.model_info).find(([key, value]) => key.endsWith('.context_length') && typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 32_000_000)?.[1] : undefined;
        return { name: name!, tools: capabilities.includes('tools'), vision: capabilities.includes('vision'), ...(typeof length === 'number' ? { contextLength: length } : {}) };
      }));
      models.push(...batch);
    }
    const value = { models };
    if (generations.get(baseUrl) === generation) {
      snapshots.delete(baseUrl); snapshots.set(baseUrl, value);
      if (snapshots.size > 16) { const oldest = snapshots.keys().next().value!; snapshots.delete(oldest); generations.delete(oldest); }
    }
    return ok(value);
  } catch { if (generations.get(baseUrl) === generation) { snapshots.delete(baseUrl); generations.delete(baseUrl); } return fail('SOURCE_UNAVAILABLE', 'Ollama에 연결하지 못했거나 모델 목록을 확인할 수 없습니다. 실행 중인 서버 주소를 확인하고 다시 연결하세요.'); }
}
export function discoveredOllamaModel(id: string, endpoint: unknown): OllamaDiscoveredModel | undefined {
  const baseUrl = normalizeOllamaEndpoint(endpoint); const name = ollamaNativeModelId(id);
  return baseUrl && name ? snapshots.get(baseUrl)?.models.find(model => model.name === name || model.name === `${name}:latest`) : undefined;
}
