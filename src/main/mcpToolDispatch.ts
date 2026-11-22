import { getOpenVideoMcpDefinition, type OpenVideoMcpServer } from './openVideoMcpServer';
import { fail, ok } from './ipcResponses';
import type { ApiResponse } from '../shared/models';

/** Dispatch only decorated tools, using the same input schemas the agent sees. */
export async function executeRegisteredEditorTool(server: OpenVideoMcpServer, name: unknown, input: unknown): Promise<ApiResponse<unknown>> {
  const definition = typeof name === 'string' ? getOpenVideoMcpDefinition()?.tools.find(tool => tool.name === name) : undefined;
  if (!definition) return fail('INVALID_INPUT', 'Choose a registered editing tool.');
  const parsed = definition.input.safeParse(input);
  if (!parsed.success) return fail('INVALID_INPUT', 'The tool arguments do not match its declared schema.');
  const method = (server as unknown as Record<string, unknown>)[definition.methodName];
  if (typeof method !== 'function') return fail('INVALID_INPUT', 'The editing tool is unavailable.');
  try { return ok(await method.call(server, parsed.data)); }
  catch (error: unknown) { return fail('UNKNOWN_ERROR', error instanceof Error ? error.message : 'The editing tool failed.'); }
}
