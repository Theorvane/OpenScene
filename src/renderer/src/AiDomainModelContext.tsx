import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import {
  AI_DOMAIN_MODEL_STORAGE_KEY,
  getDomainModel,
  parseAiDomainModelPreferences,
  getDomainModels,
  UNSELECTED_DOMAIN_MODEL,
  type AiDomain,
  type AiDomainModelConfig,
  type AiDomainModelPreferences
} from '../../shared/aiDomainModels';
import { useLlmModel } from './LlmProviderContext';
import { useChatGptAuth } from './ChatGptAuthContext';
import { isProviderConnected } from '../../shared/llmProviders';
import { isOpenAiCodexModelKey } from '../../shared/openAiAuth';
import { ollamaDomainModels } from '../../shared/ollamaModels';

type AiDomainModelContextValue = {
  readonly preferences: AiDomainModelPreferences;
  readonly models: readonly AiDomainModelConfig[];
  readonly hasConnectedProvider: boolean;
  readonly selectedModelId: (domain: AiDomain) => string;
  readonly selectedModel: (domain: AiDomain) => AiDomainModelConfig;
  readonly setSelectedModelId: (domain: AiDomain, modelId: string) => void;
};

const AiDomainModelContext = createContext<AiDomainModelContextValue | null>(null);

function getStoredPreferences(): AiDomainModelPreferences {
  if (typeof window === 'undefined') return parseAiDomainModelPreferences(null);

  try {
    const raw = window.localStorage.getItem(AI_DOMAIN_MODEL_STORAGE_KEY);
    if (raw === null) return parseAiDomainModelPreferences(null);
    return parseAiDomainModelPreferences(JSON.parse(raw) as Partial<Record<AiDomain, string>>);
  } catch {
    return parseAiDomainModelPreferences(null);
  }
}

export function AiDomainModelProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const { credentialStatus, ollama } = useLlmModel();
  const { isConnected: chatGptConnected } = useChatGptAuth();
  const models = useMemo(() => getDomainModels('edit-agent', ollamaDomainModels(ollama?.models ?? [])), [ollama?.models]);
  const connected = useCallback((model: AiDomainModelConfig) => isProviderConnected(model.providerId, credentialStatus) || (chatGptConnected && isOpenAiCodexModelKey(model.id)), [credentialStatus, chatGptConnected]);
  const [preferences, setPreferences] = useState<AiDomainModelPreferences>(getStoredPreferences);

  const setSelectedModelId = useCallback((domain: AiDomain, modelId: string): void => {
    if (modelId && !models.some(model => model.id === modelId && model.available && connected(model))) return;
    setPreferences((current) => {
      const normalized = parseAiDomainModelPreferences({ ...current, [domain]: modelId });
      try {
        window.localStorage.setItem(AI_DOMAIN_MODEL_STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        // The in-memory preference remains usable when local storage is unavailable.
      }
      return normalized;
    });
  }, [models, connected]);

  const value = useMemo<AiDomainModelContextValue>(
    () => ({
      preferences,
      models,
      hasConnectedProvider: ollama?.status === 'connected' || models.some(model => model.available && connected(model)),
      selectedModelId: (domain) => preferences[domain],
      selectedModel: (domain) => {
        const model = models.find(model => model.domains.includes(domain) && model.id === preferences[domain]);
        return model?.available && connected(model) ? model : UNSELECTED_DOMAIN_MODEL;
      },
      setSelectedModelId
    }),
    [preferences, setSelectedModelId, models, connected, ollama?.status]
  );

  return <AiDomainModelContext.Provider value={value}>{children}</AiDomainModelContext.Provider>;
}

export function useAiDomainModel(): AiDomainModelContextValue {
  const context = useContext(AiDomainModelContext);
  if (context === null) {
    throw new Error('useAiDomainModel must be used within AiDomainModelProvider.');
  }
  return context;
}
