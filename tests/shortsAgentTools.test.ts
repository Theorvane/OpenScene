import { expect, it, vi } from 'vitest';
import { OpenVideoMcpServer, getOpenVideoMcpDefinition } from '../src/main/openVideoMcpServer';
import { agentChatMutatingToolNames, AGENT_CHAT_READ_ONLY_TOOL_NAMES, createAgentChatTools, AGENT_CHAT_SPEND_TOOL_NAMES } from '../src/main/agentChatTools';

it('registers durable shorts tools with observation read-only and each job/write approved', async () => {
  const names = (getOpenVideoMcpDefinition()?.tools ?? []).map(tool => tool.name);
  for (const name of ['startShortsSelection', 'getShortsJob', 'listShortsJobs', 'createShortsProjects', 'exportShortsVideos', 'cancelShortsJob']) expect(names).toContain(name);
  expect(AGENT_CHAT_READ_ONLY_TOOL_NAMES.has('getShortsJob')).toBe(true);
  expect(AGENT_CHAT_READ_ONLY_TOOL_NAMES.has('listShortsJobs')).toBe(true);
  const mutations = agentChatMutatingToolNames(names.map(name => ({ name })));
  for (const name of ['startShortsSelection', 'createShortsProjects', 'exportShortsVideos', 'cancelShortsJob']) expect(mutations.has(name)).toBe(true);
  expect(AGENT_CHAT_SPEND_TOOL_NAMES.has('startShortsSelection')).toBe(true);
});

it('uses only the authorized conversation provider configuration for selection', async () => {
  const server = new OpenVideoMcpServer();
  const start = vi.spyOn(server, 'startShortsSelection').mockResolvedValue({ ok: false, error: { code: 'INVALID_INPUT', message: 'fixture' } });
  const tools = await createAgentChatTools(server);
  const selection = tools.find(item => item.name === 'startShortsSelection')!;
  expect(tools.filter(item => item.name === 'startShortsSelection')).toHaveLength(1);
  await selection.invoke({ projectId: 'p', assetId: 'a' }, { configurable: { modelId: 'local_qwen', ollamaBaseUrl: 'http://localhost:1234', editProjectContext: 'private context', thread_id: 'thread' } });
  expect(start).toHaveBeenCalledExactlyOnceWith({ projectId: 'p', assetId: 'a', modelId: 'local_qwen', ollamaBaseUrl: 'http://localhost:1234' });
});

it('fails closed without service and returns the durable service job rather than claiming completion', async () => {
  const server = new OpenVideoMcpServer();
  expect(await server.getShortsJob({ jobId: 'job' })).toMatchObject({ ok: false });
  const job = { id: 'job', sourceProjectId: 'p', sourceAssetId: 'a', stage: 'selecting', items: [], cleanupComplete: false };
  const service = { start: vi.fn(async () => ({ ok: true as const, value: job })), get: vi.fn(async () => ({ ok: true as const, value: job })), list: vi.fn(), materialize: vi.fn(), export: vi.fn(), cancel: vi.fn() };
  server.setShortsService(service as never);
  const result = await server.startShortsSelection({ projectId: 'p', assetId: 'a', modelId: 'local_qwen' });
  expect(result).toEqual({ ok: true, value: job });
  expect(service.start).toHaveBeenCalledExactlyOnceWith({ projectId: 'p', assetId: 'a', modelId: 'local_qwen' });
  service.get.mockRejectedValueOnce(new Error('/private/secret-path'));
  expect(JSON.stringify(await server.getShortsJob({ jobId: 'job' }))).not.toContain('secret-path');
});
