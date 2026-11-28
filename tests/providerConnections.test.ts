import { expect, it } from 'vitest';
import { parseAiDomainModelPreferences, getDefaultDomainModelId, getDomainModels } from '../src/shared/aiDomainModels';
import { parseSelectedLlmModelId } from '../src/shared/llmModels';
import { isProviderConnected } from '../src/shared/llmProviders';
import { resolveAgentChatModelSpec } from '../src/main/agentChatModel';

it('leaves the model unset with no saved choice and never treats Ollama as connected by default', () => {
  expect(parseSelectedLlmModelId(null)).toBe('');
  expect(parseSelectedLlmModelId('unknown-model')).toBe('');
  expect(getDefaultDomainModelId('edit-agent')).toBe('');
  expect(parseAiDomainModelPreferences(null)).toEqual({ 'edit-agent': '' });
  expect(isProviderConnected('local_ollama', {})).toBe(false);
  expect(getDomainModels('edit-agent').filter(model => model.providerId === 'local_ollama')).toEqual([]);
});
it('rejects unknown model ids rather than silently routing them to Ollama', () => {
  expect(() => resolveAgentChatModelSpec('unknown-model')).toThrow();
});
