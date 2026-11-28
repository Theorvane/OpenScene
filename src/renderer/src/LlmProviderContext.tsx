import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { DEFAULT_LLM_MODELS, LLM_STORAGE_CONFIG_KEY, LLM_STORAGE_MODEL_KEY, UNSELECTED_LLM_MODEL, parseSelectedLlmModelId, type LlmModelConfig, type LlmProviderApiConfig } from '../../shared/llmModels';
import { normalizeOllamaEndpoint, ollamaLlmModel, type OllamaDiscoveredModel } from '../../shared/ollamaModels';

export type LlmCredentialKey = string;
export type OllamaConnection = { readonly status: 'disconnected' | 'connecting' | 'connected' | 'error'; readonly models: readonly OllamaDiscoveredModel[]; readonly error?: string };
type LlmContextValue = {
  readonly selectedModelId: string; readonly selectedModel: LlmModelConfig;
  readonly providerConfig: LlmProviderApiConfig; readonly credentialStatus: Record<string, boolean>;
  readonly ollama: OllamaConnection;
  readonly setSelectedModelId: (id: string) => void;
  readonly updateProviderConfig: (updates: Partial<LlmProviderApiConfig>) => void;
  readonly saveProviderCredential: (key: LlmCredentialKey, value: string) => Promise<boolean>;
  readonly connectOllama: () => Promise<void>; readonly disconnectOllama: () => void;
};
const LlmContext = createContext<LlmContextValue | null>(null);
function getStoredModelId(): string {
  try { return typeof window === 'undefined' ? '' : parseSelectedLlmModelId(window.localStorage.getItem(LLM_STORAGE_MODEL_KEY)); } catch { return ''; }
}
function getStoredProviderConfig(): LlmProviderApiConfig {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LLM_STORAGE_CONFIG_KEY) ?? '{}') as LlmProviderApiConfig;
    const endpoint = normalizeOllamaEndpoint(parsed.ollamaBaseUrl);
    return { ollamaBaseUrl: endpoint ?? '', ollamaEnabled: endpoint !== null && parsed.ollamaEnabled === true };
  } catch { return { ollamaBaseUrl: '', ollamaEnabled: false }; }
}
function persistConfig(value: LlmProviderApiConfig): void {
  const endpoint = normalizeOllamaEndpoint(value.ollamaBaseUrl);
  try { window.localStorage.setItem(LLM_STORAGE_CONFIG_KEY, JSON.stringify({ ollamaBaseUrl: endpoint ?? '', ollamaEnabled: endpoint !== null && value.ollamaEnabled === true })); } catch { /* Current connection still works without storage. */ }
}
export function LlmProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [selectedModelId, setSelectedModelIdState] = useState(getStoredModelId);
  const [providerConfig, setProviderConfigState] = useState(getStoredProviderConfig);
  const [storedCredentials, setStoredCredentials] = useState<Record<string, boolean>>({});
  const [ollama, setOllama] = useState<OllamaConnection>({ status: 'disconnected', models: [] });
  const generation = useRef(0);
  const configRef = useRef(providerConfig); configRef.current = providerConfig;
  useEffect(() => {
    let live = true;
    void window.videoTool?.getProviderCredentialStatus?.().then(response => { if (live && response.ok) setStoredCredentials(response.value); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const connectOllama = useCallback(async (): Promise<void> => {
    const request = ++generation.current;
    const baseUrl = configRef.current.ollamaBaseUrl ?? '';
    setOllama({ status: 'connecting', models: [] });
    try {
      const response = await window.videoTool.discoverOllama({ baseUrl });
      if (generation.current !== request) return;
      if (!response.ok) { setOllama({ status: 'error', models: [], error: response.error.message }); return; }
      setOllama({ status: 'connected', models: response.value.models });
      const config = { ...configRef.current, ollamaEnabled: true };
      configRef.current = config; setProviderConfigState(config); persistConfig(config);
    } catch { if (generation.current === request) setOllama({ status: 'error', models: [], error: 'Ollama 연결을 확인하지 못했습니다. 서버 주소를 확인하세요.' }); }
  }, []);
  useEffect(() => {
    if (configRef.current.ollamaEnabled === true) void connectOllama();
    return () => { generation.current++; };
  }, [connectOllama]);
  const updateProviderConfig = useCallback((updates: Partial<LlmProviderApiConfig>): void => {
    generation.current++;
    setOllama({ status: 'disconnected', models: [] });
    const next = { ...configRef.current, ...updates, ollamaEnabled: false };
    configRef.current = next; setProviderConfigState(next); persistConfig(next);
  }, []);
  const disconnectOllama = useCallback(() => updateProviderConfig({ ollamaEnabled: false }), [updateProviderConfig]);
  const credentialStatus = useMemo(() => ({ ...storedCredentials, local_ollama: ollama.status === 'connected' }), [storedCredentials, ollama.status]);
  const selectedModel = useMemo(() => [...DEFAULT_LLM_MODELS, ...ollama.models.map(ollamaLlmModel)].find(model => model.id === selectedModelId) ?? UNSELECTED_LLM_MODEL, [selectedModelId, ollama.models]);
  const setSelectedModelId = useCallback((id: string): void => {
    if (id && ![...DEFAULT_LLM_MODELS, ...ollama.models.map(ollamaLlmModel)].some(model => model.id === id)) return;
    setSelectedModelIdState(id);
    try { window.localStorage.setItem(LLM_STORAGE_MODEL_KEY, id); } catch { /* Keep explicit in-memory selection. */ }
  }, [ollama.models]);
  const saveProviderCredential = useCallback(async (key: LlmCredentialKey, value: string): Promise<boolean> => {
    const response = await window.videoTool.setProviderCredential(key, value);
    if (!response.ok) return false;
    setStoredCredentials(current => ({ ...current, [key]: value.trim().length > 0 }));
    return response.value.updated;
  }, []);
  const value = useMemo<LlmContextValue>(() => ({ selectedModelId, selectedModel, providerConfig, credentialStatus, ollama, connectOllama, disconnectOllama, setSelectedModelId, updateProviderConfig, saveProviderCredential }),
    [selectedModelId, selectedModel, providerConfig, credentialStatus, ollama, connectOllama, disconnectOllama, setSelectedModelId, updateProviderConfig, saveProviderCredential]);
  return <LlmContext.Provider value={value}>{children}</LlmContext.Provider>;
}
export function useLlmModel(): LlmContextValue {
  const value = useContext(LlmContext);
  if (!value) throw new Error('useLlmModel must be used within LlmProvider.');
  return value;
}
