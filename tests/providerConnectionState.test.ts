// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
vi.mock('../src/renderer/src/ChatGptAuthContext', () => ({ useChatGptAuth: () => ({ isConnected: false }) }));

it('requires explicit connection and selection, and rejects discovery completed for a previous endpoint', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  let resolveOld!: (value: unknown) => void;
  const stale = new Promise(resolve => { resolveOld = resolve; });
  const discovered = { ok: true, value: { models: [{ name: 'custom/qwen:latest', tools: true, vision: true }] } };
  const discover = vi.fn().mockReturnValueOnce(stale).mockResolvedValue(discovered);
  Object.assign(window, { videoTool: { getProviderCredentialStatus: async () => ({ ok: true, value: {} }), discoverOllama: discover } });
  const providerPath = '../src/renderer/src/LlmProviderContext'; const domainPath = '../src/renderer/src/AiDomainModelContext';
  const { LlmProvider, useLlmModel } = await import(providerPath);
  const { AiDomainModelProvider, useAiDomainModel } = await import(domainPath);
  let llm!: ReturnType<typeof useLlmModel>; let domain!: ReturnType<typeof useAiDomainModel>;
  function Probe() { llm = useLlmModel(); domain = useAiDomainModel(); return null; }
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(LlmProvider, {}, createElement(AiDomainModelProvider, {}, createElement(Probe)))));
    expect(llm.selectedModelId).toBe(''); expect(domain.selectedModel('edit-agent').id).toBe('');
    expect(discover).not.toHaveBeenCalled();
    act(() => llm.updateProviderConfig({ ollamaBaseUrl: 'http://first:11434' }));
    let pending!: Promise<void>; act(() => { pending = llm.connectOllama(); });
    act(() => llm.updateProviderConfig({ ollamaBaseUrl: 'http://second:11434' }));
    await act(async () => { resolveOld(discovered); await pending; });
    expect(llm.ollama.status).toBe('disconnected'); expect(llm.ollama.models).toEqual([]);
    await act(async () => { await llm.connectOllama(); });
    expect(llm.ollama.status).toBe('connected'); expect(domain.selectedModel('edit-agent').id).toBe('');
    act(() => domain.setSelectedModelId('edit-agent', 'local_ollama/custom/qwen:latest'));
    expect(domain.selectedModel('edit-agent').id).toBe('local_ollama/custom/qwen:latest');
    act(() => llm.disconnectOllama());
    expect(domain.selectedModel('edit-agent').id).toBe(''); expect(llm.credentialStatus.local_ollama).toBe(false);
  } finally { act(() => root.unmount()); window.localStorage.clear(); }
});
