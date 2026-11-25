import { describe, expect, it } from 'vitest';
import { AGENT_CHAT_CUA_ACTION_TOOL_NAME, AGENT_CHAT_CUA_SAVE_TOOL_NAME, prepareProjectForAgentApproval } from '../src/shared/agentChat';

describe('actual approval preparation policy', () => {
  it.each([AGENT_CHAT_CUA_ACTION_TOOL_NAME, AGENT_CHAT_CUA_SAVE_TOOL_NAME])('%s preserves dirty UI and emits no legacy save for any decision', async (name) => {
    for (const decision of ['approve', 'always', 'deny'] as const) {
      let dirty = true, saveIpcCalls = 0;
      const allowed = await prepareProjectForAgentApproval(name, decision, async () => { saveIpcCalls++; dirty = false; return true; });
      expect(allowed).toBe(true);
      expect(saveIpcCalls).toBe(0);
      expect(dirty).toBe(true);
    }
  });

  it.each(['approve', 'always'] as const)('preserves existing ordinary MCP %s preparation', async (decision) => {
    let dirty = true, saveIpcCalls = 0;
    expect(await prepareProjectForAgentApproval('trimTimelineClip', decision, async () => { saveIpcCalls++; dirty = false; return true; })).toBe(true);
    expect(saveIpcCalls).toBe(1);
    expect(dirty).toBe(false);
  });

  it('never saves on denial, including an ordinary MCP tool', async () => {
    expect(await prepareProjectForAgentApproval('editProject', 'deny', async () => { throw new Error('A denied call must not prepare/write.'); })).toBe(true);
  });

  it('keeps ordinary MCP preparation failure as a failed approval precondition', async () => {
    expect(await prepareProjectForAgentApproval('editProject', 'approve', async () => false)).toBe(false);
    await expect(prepareProjectForAgentApproval('editProject', 'approve', async () => { throw new Error('save failed'); })).rejects.toThrow('save failed');
    expect(await prepareProjectForAgentApproval('editProject', 'approve')).toBe(true);
  });
});
