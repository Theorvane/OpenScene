import { ollamaNativeModelId, ollamaLlmModel } from './ollamaModels';
import { LLM_CATALOG } from './llmCatalog.generated';
import { AGENT_ROUTER_MODELS, AGENT_ROUTER_PROVIDER_ID } from './agentRouter';

export type LlmProviderId = string;

export type LlmModelCategory = 'editor-assistant' | 'video-prompt' | 'voice-script';

export type LlmModelBadge = 'LOCAL' | 'FAST' | 'SMART' | 'REASONING';

export interface LlmModelConfig {
  /** Canonical key: `providerId/modelId` for cloud, bare id for local. */
  readonly id: string;
  readonly providerId: LlmProviderId;
  readonly label: string;
  readonly providerLabel: string;
  readonly description: string;
  readonly category: LlmModelCategory;
  readonly badge: LlmModelBadge;
  readonly defaultMode: 'local' | 'api';
  /** Whether this model's provider adapter is implemented in the current build. */
  readonly available: boolean;
  readonly unavailabilityReason?: string;
  /** Whether the model supports structured tool calling (Edit Agent requirement). */
  readonly toolCall?: boolean;
  readonly contextWindow?: string;
  /** Whether the model accepts image input (needed to see watchProjectVideo frames). */
  readonly vision?: boolean;
}

/** Split a canonical model key into its provider and provider-native model id. */
export function parseLlmModelKey(key: string): { readonly providerId: string; readonly modelId: string } | null {
  const slash = key.indexOf('/');
  if (slash <= 0 || slash === key.length - 1) return null;
  return { providerId: key.slice(0, slash), modelId: key.slice(slash + 1) };
}

function describeCloudModel(providerLabel: string, flags: { toolCall?: boolean; reasoning?: boolean; vision?: boolean }): string {
  const traits = [
    flags.reasoning === true ? 'reasoning' : null,
    flags.toolCall === true ? 'tool calling' : null,
    flags.vision === true ? 'vision' : null
  ].filter((trait): trait is string => trait !== null);
  return traits.length > 0 ? `${providerLabel} model with ${traits.join(', ')}.` : `${providerLabel} model.`;
}

/** Full models.dev catalog flattened into canonical `providerId/modelId` entries. */
export const DEFAULT_LLM_MODELS: readonly LlmModelConfig[] = [
  ...AGENT_ROUTER_MODELS.map((model): LlmModelConfig => ({
    id: `${AGENT_ROUTER_PROVIDER_ID}/${model.id}`,
    providerId: AGENT_ROUTER_PROVIDER_ID,
    label: model.label,
    providerLabel: 'AgentRouter',
    description: 'AgentRouter account model alias; runnable in desktop Writer through Codex CLI.',
    category: 'editor-assistant',
    badge: model.reasoning ? 'REASONING' : 'SMART',
    defaultMode: 'api',
    available: true,
    toolCall: true
  })),
  ...LLM_CATALOG.flatMap((provider) =>
    provider.models.map((model): LlmModelConfig => ({
      id: `${provider.id}/${model.id}`,
      providerId: provider.id,
      label: model.label,
      providerLabel: provider.label,
      description: describeCloudModel(provider.label, model),
      category: 'editor-assistant',
      badge: model.reasoning === true ? 'REASONING' : 'SMART',
      defaultMode: 'api',
      available: true,
      ...(model.toolCall === true ? { toolCall: true } : {}),
      ...(model.vision === true ? { vision: true } : {}),
      ...(model.contextK === undefined ? {} : { contextWindow: `${model.contextK}k` })
    }))
  )
];

const MODELS_BY_ID = new Map(DEFAULT_LLM_MODELS.map((model) => [model.id, model]));

export const LLM_STORAGE_MODEL_KEY = 'openvideo-selected-llm-model';
export const LLM_STORAGE_CONFIG_KEY = 'openvideo-llm-provider-config';

export interface LlmProviderApiConfig {
  ollamaBaseUrl?: string;
  ollamaEnabled?: boolean;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  deepseekApiKey?: string;
  elevenlabsApiKey?: string;
  runwayApiKey?: string;
  klingApiKey?: string;
  lumaApiKey?: string;
}

export function getLlmModel(modelId: string): LlmModelConfig | undefined {
  const known = MODELS_BY_ID.get(modelId);
  if (known) return known;
  const native = ollamaNativeModelId(modelId);
  return native ? { ...ollamaLlmModel({ name: native, tools: false, vision: false }), id: modelId } : undefined;
}

export const UNSELECTED_LLM_MODEL: LlmModelConfig = { id: '', providerId: '', label: '모델 선택 필요', providerLabel: '', description: '모델 제공자를 연결하고 사용할 모델을 선택하세요.', category: 'editor-assistant', badge: 'SMART', defaultMode: 'api', available: false };

export function parseSelectedLlmModelId(storedId: string | null | undefined): string {
  return storedId && (MODELS_BY_ID.has(storedId) || ollamaNativeModelId(storedId)) ? storedId : '';
}
