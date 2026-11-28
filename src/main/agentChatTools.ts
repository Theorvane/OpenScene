import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { InstanceResolver } from '@theorvane/type-mcp';
import { createLangChainTools } from '@theorvane/type-mcp/langchain';
import { OpenVideoMcpServer } from './openVideoMcpServer';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { CUA_KEYS } from '../shared/cua';
import type { CuaAgentOrchestrator } from './cuaAgentOrchestration';
import type { CuaAgentSaveOrchestrator } from './cuaAgentSaveOrchestration';
import { parseEditAgentProjectContext } from '../shared/editAgentContext';
import { AGENT_CHAT_CUA_ACTION_TOOL_NAME, AGENT_CHAT_CUA_SAVE_TOOL_NAME } from '../shared/agentChat';
import type { ShortsStartInput } from '../shared/shortsTypes';
import { runShortsJobTool } from './shortsAgentTools';

/**
 * The tools that read and change nothing.
 *
 * Written as the read-only list rather than as the mutating one, because the
 * graph asks the question in a way that fails open:
 *
 *     const decision = mutatingToolNames.has(call.name) ? toolDecisions[call.id] : 'approve';
 *
 * A name that is missing from a *mutating* list is auto-approved, so forgetting
 * to add a tool means it writes to someone's project without asking — and that
 * is not hypothetical: `splitTimelineClip`, `addTimelineTitle`,
 * `removeTimelineTitle` and `setTimelineTransition` all shipped that way, while
 * the README promised "anything that writes to your project or starts a job
 * pauses for approval first".
 *
 * Inverted, the cost of forgetting is one unnecessary prompt. Six names change
 * rarely; the tools that touch a project change often.
 *
 * (See docs/hybrid-ai-editor-direction.md §2.2/§4.3.)
 */
export const AGENT_CHAT_READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'getProjectTimeline',
  'watchProjectVideo',
  'getEditingCapabilities',
  'planAutoClipEdit',
  'getShortsJob',
  'listShortsJobs',
  'getCanvasWorkflow',
  'observeEditorWindow'
]);

/**
 * Everything the agent can call that is not on that list.
 *
 * Derived from the tools themselves rather than kept as a second list, so the
 * two cannot drift — which is the failure this replaces.
 */
export function agentChatMutatingToolNames(tools: readonly { readonly name: string }[]): ReadonlySet<string> {
  return new Set(tools.map((tool) => tool.name).filter((name) => !AGENT_CHAT_READ_ONLY_TOOL_NAMES.has(name)));
}

export async function createAgentChatTools(instance: OpenVideoMcpServer, cua?: CuaAgentOrchestrator, cuaSave?: CuaAgentSaveOrchestrator): Promise<readonly DynamicStructuredTool[]> {
  const resolver: InstanceResolver<OpenVideoMcpServer> = { resolve: () => instance };
  const tools = await createLangChainTools(OpenVideoMcpServer, { resolver });
  // Provider selection comes from the authorized conversation, never invented tool arguments.
  const selection = tool(async (args, config) => {
    const selected = config?.configurable as Partial<Pick<ShortsStartInput, 'modelId' | 'openAiAuthMode' | 'ollamaBaseUrl' | 'reasoningEffort'>> | undefined;
    if (!selected?.modelId) return JSON.stringify({ ok: false, error: { code: 'INVALID_INPUT', message: 'Select a model before requesting shorts.' } });
    const response = await runShortsJobTool(instance, () => instance.startShortsSelection({ projectId: args.projectId, assetId: args.assetId, modelId: selected.modelId!,
      ...(args.requestedCount === undefined ? {} : { requestedCount: args.requestedCount }),
      ...(args.minDurationMs === undefined ? {} : { minDurationMs: args.minDurationMs }),
      ...(args.maxDurationMs === undefined ? {} : { maxDurationMs: args.maxDurationMs }),
      ...(selected.openAiAuthMode === undefined ? {} : { openAiAuthMode: selected.openAiAuthMode }),
      ...(selected.ollamaBaseUrl === undefined ? {} : { ollamaBaseUrl: selected.ollamaBaseUrl }),
      ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }) }), config?.signal);
    return JSON.stringify(response);
  }, { name: 'startShortsSelection', description: 'Only when requested: analyze an imported video for shorts using this conversation’s selected model/provider and configured local transcription. Requires approval for provider use. Returns a durable job, not completed videos. Read getShortsJob, review evidence, then separately approve createShortsProjects and exportShortsVideos. Never install services/models.',
    schema: z.object({ projectId: z.string().min(1), assetId: z.string().min(1), requestedCount: z.number().int().min(1).max(5).optional(), minDurationMs: z.number().int().positive().optional(), maxDurationMs: z.number().int().positive().optional() }).strict() });
  const materialize = tool(async (args, config) => JSON.stringify(await runShortsJobTool(instance, () => instance.createShortsProjects(args), config?.signal)), {
    name: 'createShortsProjects', description: 'After reviewing evidence and obtaining approval, create separate editable shorts projects with reviewed captions. Waits for completion and returns actual result project IDs. This is not MP4 rendering. Original media is preserved.',
    schema: z.object({ jobId: z.string().min(1), candidateIds: z.array(z.string().min(1)).min(1).max(5) }).strict() });
  const render = tool(async (args, config) => JSON.stringify(await runShortsJobTool(instance, () => instance.exportShortsVideos(args), config?.signal)), {
    name: 'exportShortsVideos', description: 'Separately approved FFmpeg rendering of created result projects to actual local MP4 videos. Waits for completion; report completed/failed/cancelled items accurately. Results are in the video list. Do not claim all outputs completed on a partial run.',
    schema: z.object({ jobId: z.string().min(1), resultProjectIds: z.array(z.string().min(1)).min(1).max(5) }).strict() });
  return [...tools.filter(item => !['startShortsSelection', 'createShortsProjects', 'exportShortsVideos'].includes(item.name)), selection, materialize, render, ...(cua ? createCuaAgentChatTools(cua) : []), ...(cuaSave ? createCuaSaveAgentChatTools() : [])];
}

const point = z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }).strict();
export const CUA_ACTION_TOOL_SCHEMA = z.object({
  sessionId: z.string().min(1), runId: z.string().min(1), windowId: z.number().int().nonnegative(),
  frameId: z.string().min(1), layoutRevision: z.number().int().nonnegative(), contentRevision: z.number().int().nonnegative(),
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('click'), point }).strict(),
    z.object({ kind: z.literal('drag'), from: point, to: point, durationMs: z.number().int().min(100).max(3000) }).strict(),
    z.object({ kind: z.literal('key'), key: z.enum(CUA_KEYS), modifiers: z.array(z.enum(['shift', 'control', 'meta', 'alt'])).max(1) }).strict()
  ])
}).strict();

/** Scope only. The backend supplies and pins the actual immutable proposal. */
export const CUA_SAVE_TOOL_SCHEMA = z.object({
  projectId: z.string().min(1), sessionId: z.string().min(1), runId: z.string().min(1),
  windowId: z.number().int().nonnegative(), frameId: z.string().min(1),
  layoutRevision: z.number().int().nonnegative(), contentRevision: z.number().int().nonnegative()
}).strict();

export const AGENT_CHAT_CUA_PER_CALL_TOOL_NAMES: ReadonlySet<string> = new Set([AGENT_CHAT_CUA_ACTION_TOOL_NAME, AGENT_CHAT_CUA_SAVE_TOOL_NAME]);

export function createCuaSaveAgentChatTools(): DynamicStructuredTool[] {
  return [tool(async () => { throw new Error('CUA_APPROVAL_MISMATCH: Only the main graph approval dispatch can save an approved snapshot.'); }, {
    name: AGENT_CHAT_CUA_SAVE_TOOL_NAME, description: 'Explicitly request Save of the exact current live editor snapshot, using the latest observed project/session/run/window/frame/layout/content scope. Main pins and summarizes the snapshot before per-call approval. Run this tool alone. It cannot approve itself, use a pointer permit, bypass protected controls or silently autosave. Verify the terminal disk receipt and saved MCP timeline; never retry a confirmed write after a later observation/UI acknowledgement failure.', schema: CUA_SAVE_TOOL_SCHEMA
  })];
}

export function createCuaAgentChatTools(cua: CuaAgentOrchestrator): DynamicStructuredTool[] {
  return [
    tool(async (_args, config) => {
      const conversationId = config?.configurable?.thread_id;
      if (typeof conversationId !== 'string') throw new Error('CUA_SCOPE_CHANGED');
      let projectId: string | undefined;
      try { projectId = parseEditAgentProjectContext(JSON.parse(config?.configurable?.editProjectContext ?? 'null'))?.projectId; }
      catch { /* Missing main conversation project context cannot authorize Save. */ }
      return JSON.stringify(await cua.observe(conversationId, projectId));
    }, { name: 'observeEditorWindow', description: 'Observe only this OpenScene editor window. Returns a frame and CSS coordinate scope; use exactly those IDs for a proposed action. No OS-wide control.', schema: z.object({}).strict() }),
    tool(async () => { throw new Error('CUA_APPROVAL_MISMATCH: Only the main graph approval dispatch can execute an action.'); }, {
      name: AGENT_CHAT_CUA_ACTION_TOOL_NAME, description: 'Propose one click, bounded drag or allowed key in the observed OpenScene editor. Requires a fresh exact per-call human approval; always never authorizes later actions. Successful input consumes its frame; observeEditorWindow separately before another action. An observation failure must not retry successful input. MCP timeline reads saved state, which may lag unsaved UI. No implicit recapture or coordinate conversion.', schema: CUA_ACTION_TOOL_SCHEMA
    })
  ];
}

/**
 * Tools that bill the user's provider account. These are approved per call and
 * are deliberately excluded from the always-allow shortcut: "always" is a
 * reasonable answer to "may I trim this clip again", and an unreasonable one to
 * "may I charge your card whenever I like". Every charge stays visible.
 */
export const AGENT_CHAT_SPEND_TOOL_NAMES: ReadonlySet<string> = new Set(['startShortsSelection']);
