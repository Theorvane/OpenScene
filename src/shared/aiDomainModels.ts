import {
  AGENT_ROUTER_EDIT_AGENT_UNAVAILABLE_REASON,
  AGENT_ROUTER_MODELS,
  AGENT_ROUTER_PROVIDER_ID
} from './agentRouter';
import { LLM_CATALOG } from './llmCatalog.generated';

export type AiDomain = 'edit-agent';
export type AiRuntime = 'desktop' | 'mobile';

export type AiDomainProvider = {
  readonly id: string;
  readonly label: string;
  readonly executionPath: 'local' | 'api';
};

export const AI_DOMAIN_PROVIDERS: readonly AiDomainProvider[] = [
  { id: 'local_ollama', label: 'Ollama', executionPath: 'local' },
  ...LLM_CATALOG.map(provider => ({ id: provider.id, label: provider.label, executionPath: 'api' as const }))
];

export type AiDomainModelConfig = {
  readonly id: string;
  readonly providerId: string;
  readonly label: string;
  readonly providerLabel: string;
  readonly description: string;
  readonly executionPath: 'local' | 'api';
  readonly domains: readonly AiDomain[];
  readonly available: boolean;
  readonly unavailableReason?: string;
  /** Omitted when a runnable model works on both front ends. */
  readonly availableOn?: readonly AiRuntime[];
  readonly contextWindow?: string;
  readonly availableContexts?: readonly string[];
  readonly precisionBit?: string;
  readonly availablePrecisions?: readonly string[];
  /** Model supports a reasoning-effort setting. */
  readonly reasoning?: boolean;
  /** Effort levels this model accepts (its "variants"). */
  readonly efforts?: readonly string[];
};

export type AiDomainModelPreferences = Record<AiDomain, string>;

export const AI_DOMAIN_MODEL_STORAGE_KEY = 'openvideo-ai-domain-model-preferences-v1';

const AI_DOMAIN_MODEL_CATALOG: readonly AiDomainModelConfig[] = [
  {
    id: 'qwen2.5-coder',
    providerId: 'local_ollama',
    label: 'Qwen 2.5 Coder 14B',
    providerLabel: 'Ollama',
    description: 'Local tool-calling model for LangGraph edit operations.',
    executionPath: 'local',
    precisionBit: '4-bit (Q4_K_M)',
    availablePrecisions: ['4-bit (Q4_K_M)', '8-bit (Q8_0)', '16-bit (FP16)'],
    domains: ['edit-agent'],
    available: true
  },
  ...AGENT_ROUTER_MODELS.map((model): AiDomainModelConfig => ({
    id: `${AGENT_ROUTER_PROVIDER_ID}/${model.id}`,
    providerId: AGENT_ROUTER_PROVIDER_ID,
    label: model.label,
    providerLabel: 'AgentRouter',
    description: 'AgentRouter account model alias for agentic timeline editing.',
    executionPath: 'api',
    domains: ['edit-agent'],
    available: false,
    unavailableReason: AGENT_ROUTER_EDIT_AGENT_UNAVAILABLE_REASON,
    reasoning: model.reasoning
  })),
  ...LLM_CATALOG.flatMap((provider) =>
    provider.models
      .filter((model) => model.toolCall === true)
      .map((model): AiDomainModelConfig => ({
        id: `${provider.id}/${model.id}`,
        providerId: provider.id,
        label: model.label,
        providerLabel: provider.label,
        description: `${provider.label} cloud tool-calling model for agentic timeline editing.`,
        executionPath: 'api',
        ...(model.contextK === undefined ? {} : { contextWindow: `${model.contextK}k` }),
        ...(model.reasoning === true ? { reasoning: true } : {}),
        ...(model.efforts === undefined ? {} : { efforts: model.efforts }),
        domains: ['edit-agent'],
        available: true
      }))
  )
];

const AI_DOMAINS: readonly AiDomain[] = ['edit-agent'];

export function formatAiModelOptionLabel(model: AiDomainModelConfig): string {
  const isZen = model.id === 'qwen2.5-coder';
  const prefix = isZen ? '★ ' : '';
  const statusSuffix = model.available ? '' : ' (Unavailable)';
  return `${prefix}${model.providerLabel} → ${model.label}${statusSuffix}`;
}

export function getDomainModels(domain: AiDomain): readonly AiDomainModelConfig[] {
  return AI_DOMAIN_MODEL_CATALOG.filter(model => model.domains.includes(domain));
}

export function getAvailableDomainModels(domain: AiDomain): readonly AiDomainModelConfig[] {
  return getDomainModels(domain).filter((model) => model.available);
}

export function isDomainModelAvailableOnRuntime(model: AiDomainModelConfig, runtime: AiRuntime): boolean {
  return model.available && (model.availableOn === undefined || model.availableOn.includes(runtime));
}

export function getDomainModel(domain: AiDomain, modelId: string): AiDomainModelConfig | undefined {
  return getDomainModels(domain).find((model) => model.id === modelId);
}

export function getDefaultDomainModelId(domain: AiDomain): string {
  const model = getAvailableDomainModels(domain)[0];
  if (model === undefined) {
    throw new Error(`No available AI model is configured for domain ${domain}.`);
  }
  return model.id;
}

export function parseAiDomainModelPreferences(stored: Partial<Record<AiDomain, string>> | null | undefined): AiDomainModelPreferences {
  return Object.fromEntries(
    AI_DOMAINS.map((domain) => {
      const candidate = stored?.[domain];
      const normalizedCandidate = candidate?.startsWith('openai-codex/')
        ? `openai/${candidate.slice('openai-codex/'.length)}`
        : candidate;
      const model = normalizedCandidate === undefined ? undefined : getDomainModel(domain, normalizedCandidate);
      return [domain, model?.available ? model.id : getDefaultDomainModelId(domain)];
    })
  ) as AiDomainModelPreferences;
}
