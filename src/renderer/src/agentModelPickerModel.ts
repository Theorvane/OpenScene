import { getDomainModels, type AiDomain, type AiDomainModelConfig } from '../../shared/aiDomainModels';
import { isProviderConnected } from '../../shared/llmProviders';
import { isOpenAiCodexModelKey } from '../../shared/openAiAuth';

export type AgentModelGroup = {
  readonly providerId: string;
  readonly providerLabel: string;
  readonly models: readonly AiDomainModelConfig[];
};

export type AgentModelPickerInput = {
  /** Defaults to the Edit Agent; the voice and video studios pass their own. */
  readonly domain?: AiDomain;
  readonly activeModelId: string;
  readonly credentialStatus: Readonly<Record<string, boolean>>;
  readonly chatGptConnected: boolean;
  readonly isModelVisible: (providerId: string, modelId: string) => boolean;
  /** Models reachable through a non-API session without linking their whole provider. */
  readonly linkedModelIds?: readonly string[];
  readonly models?: readonly AiDomainModelConfig[];
};

/**
 * A model is reachable when its provider holds an API key, or — for OpenAI
 * Codex-family models — when a ChatGPT sign-in is connected.
 */
export function isAgentModelLinked(input: {
  readonly providerId: string;
  readonly modelId: string;
  readonly credentialStatus: Readonly<Record<string, boolean>>;
  readonly chatGptConnected: boolean;
  readonly linkedModelIds?: readonly string[];
}): boolean {
  return (
    isProviderConnected(input.providerId, input.credentialStatus) ||
    input.linkedModelIds?.includes(input.modelId) === true ||
    (input.chatGptConnected && isOpenAiCodexModelKey(input.modelId))
  );
}

/**
 * Only connected providers expose available models. Keep an explicitly selected
 * connected model visible even if its catalog visibility was switched off.
 */
export function buildAgentModelGroups(input: AgentModelPickerInput): readonly AgentModelGroup[] {
  const models = (input.models ?? getDomainModels(input.domain ?? 'edit-agent')).filter((model) => {
    if (!model.available) return false;
    if (
      !isAgentModelLinked({
        providerId: model.providerId,
        modelId: model.id,
        credentialStatus: input.credentialStatus,
        chatGptConnected: input.chatGptConnected,
        ...(input.linkedModelIds === undefined ? {} : { linkedModelIds: input.linkedModelIds })
      })
    ) {
      return false;
    }
    return model.id === input.activeModelId || input.isModelVisible(model.providerId, model.id);
  });

  const groups: { providerId: string; providerLabel: string; models: AiDomainModelConfig[] }[] = [];
  for (const model of models) {
    const existing = groups.find((group) => group.providerId === model.providerId);
    if (existing === undefined) {
      groups.push({ providerId: model.providerId, providerLabel: model.providerLabel, models: [model] });
    } else {
      existing.models.push(model);
    }
  }
  return groups;
}

/** Connection label for a provider group header. */
export function agentModelGroupStatus(
  group: AgentModelGroup,
  input: { readonly credentialStatus: Readonly<Record<string, boolean>>; readonly chatGptConnected: boolean }
): 'Local' | 'Connected' | 'ChatGPT' | 'Not connected' {
  if (isProviderConnected(group.providerId, input.credentialStatus)) return 'Connected';
  const linkedBySignIn = group.models.some((model) =>
    isAgentModelLinked({
      providerId: group.providerId,
      modelId: model.id,
      credentialStatus: input.credentialStatus,
      chatGptConnected: input.chatGptConnected
    })
  );
  return linkedBySignIn ? 'ChatGPT' : 'Not connected';
}
