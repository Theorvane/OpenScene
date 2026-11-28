import { describe, expect, it } from 'vitest';

import {
  AI_DOMAIN_MODEL_STORAGE_KEY,
  getAvailableDomainModels,
  getDomainModel,
  getDefaultDomainModelId,
  getDomainModels,
  isDomainModelAvailableOnRuntime,
  parseAiDomainModelPreferences
} from '../src/shared/aiDomainModels';

describe('AI domain model catalog', () => {

  it('leaves model selection empty until the user chooses a connected provider model', () => {
    expect(getDefaultDomainModelId('edit-agent')).toBe('');
    expect(getAvailableDomainModels('edit-agent').every(model => model.executionPath === 'api')).toBe(true);
  });

  it('normalizes a legacy OpenAI Codex edit-agent preference before availability validation', () => {
    expect(
      parseAiDomainModelPreferences({ 'edit-agent': 'openai-codex/gpt-5' })['edit-agent']
    ).toBe('openai/gpt-5');
  });

  it('uses a versioned non-secret storage key', () => {
    expect(AI_DOMAIN_MODEL_STORAGE_KEY).toBe('openvideo-ai-domain-model-preferences-v1');
  });
});
