import type { EditAgentContextAsset, EditAgentProjectContext } from './editAgentContext';
import type { OpenAiAuthMode, ReasoningEffort } from './openAiAuth';

export type AgentChatMessageRole = 'user' | 'assistant' | 'tool';

export interface AgentChatDisplayMessage {
  readonly id: string;
  readonly role: AgentChatMessageRole;
  readonly text: string;
  readonly toolName?: string | undefined;
}

export interface AgentToolCallProposal {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
}

export type AgentChatStatus = 'idle' | 'thinking' | 'awaiting-approval' | 'error';
export type AgentChatInteractionMode = 'project-tools';

/**
 * How much of the model's context window the conversation is using, measured
 * from the last turn that reported usage. `limitTokens` is absent for models
 * whose context size the catalog does not publish.
 */
export interface AgentChatContextUsage {
  readonly usedTokens: number;
  readonly limitTokens?: number | undefined;
}

export interface AgentChatTurnState {
  readonly conversationId: string;
  readonly messages: readonly AgentChatDisplayMessage[];
  readonly pendingApproval: AgentToolCallProposal | null;
  readonly status: AgentChatStatus;
  readonly error?: string | undefined;
  readonly contextUsage?: AgentChatContextUsage | undefined;
}

export interface AgentChatSendInput {
  readonly conversationId: string;
  readonly text: string;
  readonly modelId: string;
  /** Explicit opt-in; omitted requests retain ordinary project-tool behavior. */
  readonly interactionMode?: AgentChatInteractionMode | undefined;
  readonly hasUnsavedTimeline?: boolean | undefined;
  readonly openAiAuthMode?: OpenAiAuthMode | undefined;
  readonly reasoningEffort?: ReasoningEffort | undefined;
  readonly ollamaBaseUrl?: string | undefined;
  readonly contextAssets?: readonly EditAgentContextAsset[] | undefined;
  readonly activeProject?: EditAgentProjectContext | undefined;
  /**
   * Transcript restored from persisted chat history. When the in-memory
   * conversation thread is empty (e.g. after a relaunch), these messages
   * re-seed the model so the conversation can continue where it left off.
   */
  readonly restoredMessages?: readonly AgentChatDisplayMessage[] | undefined;
}

/**
 * `approve` runs the call once; `always` also stops asking for that tool for
 * the rest of the conversation; `deny` refuses it and may carry feedback that
 * reaches the model as a correction instead of a bare refusal.
 */
export type AgentToolApprovalDecision = 'approve' | 'always' | 'deny';

/** Persist the live project before executing saved-project tools. */
export async function prepareProjectForAgentApproval(_toolName: string, decision: AgentToolApprovalDecision, prepareProject?: () => Promise<boolean>, _mode?: AgentChatInteractionMode): Promise<boolean> {
  return decision === 'deny' || !prepareProject ? true : prepareProject();
}
export async function prepareProjectForAgentSend(_mode: AgentChatInteractionMode, prepareProject?: () => Promise<boolean>): Promise<boolean> {
  return prepareProject ? prepareProject() : true;
}
export function toolsForAgentInteractionMode<T>(tools: readonly T[], _mode: AgentChatInteractionMode): readonly T[] { return tools; }

export interface AgentChatApprovalInput {
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly decision: AgentToolApprovalDecision;
  readonly feedback?: string | undefined;
}

/** Fold the conversation into a summary so it keeps fitting the context window. */
export interface AgentChatCompactInput {
  readonly conversationId: string;
}

export interface AgentChatResetInput {
  readonly conversationId: string;
}

/** Cancel the named conversation; main must settle input release before returning. */
export interface AgentChatCancelInput {
  readonly conversationId: string;
}

/** One persisted Edit Agent conversation, stored inside its project folder. */
export interface AgentChatStoredConversation {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly AgentChatDisplayMessage[];
}

/** Path-free summary row for the home screen chat history list. */
export interface AgentChatHistoryEntry {
  readonly projectId: string;
  readonly projectName: string;
  readonly conversationId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly messageCount: number;
}

export interface AgentChatHistoryGetInput {
  readonly projectId: string;
  readonly conversationId: string;
}
