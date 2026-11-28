import type { AiDomainModelConfig } from './aiDomainModels';
import type { LlmModelConfig } from './llmModels';

export const OLLAMA_PROVIDER_ID = 'local_ollama'; // Persisted compatibility identifier.
export type OllamaDiscoveredModel = { readonly name: string; readonly tools: boolean; readonly vision: boolean; readonly contextLength?: number };
export type OllamaDiscovery = { readonly models: readonly OllamaDiscoveredModel[] };
export function normalizeOllamaEndpoint(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? url.href.replace(/\/+$/, '') : null;
  } catch { return null; }
}
export function isOllamaModelName(name: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/.test(name); }
export function ollamaNativeModelId(id: string): string | null {
  const legacy: Readonly<Record<string, string>> = { local_qwen: 'qwen2.5-coder', 'qwen2.5-coder': 'qwen2.5-coder', 'llama3.2-vision': 'llama3.2-vision' };
  const name = id.startsWith(`${OLLAMA_PROVIDER_ID}/`) ? id.slice(OLLAMA_PROVIDER_ID.length + 1) : legacy[id];
  return name && isOllamaModelName(name) ? name : null;
}
export function ollamaLlmModel(model: OllamaDiscoveredModel): LlmModelConfig {
  return { id: `${OLLAMA_PROVIDER_ID}/${model.name}`, providerId: OLLAMA_PROVIDER_ID, label: model.name, providerLabel: 'Ollama', description: 'Model provided by the connected Ollama endpoint.', category: 'editor-assistant', badge: 'SMART', defaultMode: 'api', available: true, toolCall: model.tools, vision: model.vision,
    ...(model.contextLength === undefined ? {} : { contextWindow: `${Math.floor(model.contextLength / 1024)}k` }) };
}
export function ollamaDomainModels(models: readonly OllamaDiscoveredModel[]): readonly AiDomainModelConfig[] {
  return models.filter(model => model.tools).map(model => ({ ...ollamaLlmModel(model), executionPath: 'api', domains: ['edit-agent'] }));
}
