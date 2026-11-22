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

  it('keeps the local model as the edit-agent default ahead of cloud providers', () => {
    expect(getAvailableDomainModels('edit-agent')[0]?.executionPath).toBe('local');
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
