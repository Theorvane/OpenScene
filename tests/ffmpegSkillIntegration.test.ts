import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { FFMPEG_EDITING_WORKFLOW } from '../src/shared/ffmpegEditingWorkflow';
import { buildAgentChatGraph } from '../src/main/agentChatGraph';
import { AgentChatSessionManager } from '../src/main/agentChatSession';

const root = resolve(process.cwd(), '.agents/skills/ffmpeg-skill');
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'UPSTREAM.json'), 'utf8')) as {
  repository: string; commit: string; version: string; files: Record<string, string>;
};

describe('pinned ffmpeg-skill integration', () => {
  it('preserves the upstream snapshot and license', () => {
    expect(manifest.repository).toBe('https://github.com/kajisho5/ffmpeg-skill');
    expect(manifest.commit).toBe('3145261a1c19f399b9520fad7fdac741871e1426');
    expect(manifest.version).toBe('3.13.1');
    expect(Object.keys(manifest.files).length).toBeGreaterThan(60);
    for (const [path, expected] of Object.entries(manifest.files)) {
      expect(path).not.toMatch(/^\/|\.\./);
      expect(createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex'), path).toBe(expected);
    }
    expect(readFileSync(resolve(root, 'LICENSE'), 'utf8')).toContain('Copyright (c) 2026 kajisho5');
    expect(read('THIRD_PARTY_NOTICES.md')).toContain('kajisho5/ffmpeg-skill');
  });

  it('includes the complete 42-tool Python distribution without an installer', () => {
    const tools = readdirSync(resolve(root, 'scripts')).filter((name) => name.endsWith('.py') && !name.startsWith('_'));
    expect(tools).toHaveLength(42);
    expect(manifest.files).toHaveProperty('mcp/server.py');
    expect(manifest.files).toHaveProperty('references/workflow.md');
    expect(manifest.files).toHaveProperty('docs/contract.md');
    expect(readdirSync(root)).not.toContain('bin');
  });

  it('places the shared workflow in the actual desktop model system message', async () => {
    let systemText = '';
    const bundle = buildAgentChatGraph({
      tools: [], mutatingToolNames: new Set(),
      createModel: () => ({ invoke: async (messages) => {
        systemText = String(messages[0]?.content);
        return new AIMessage('Ready.');
      } })
    });
    const session = new AgentChatSessionManager(bundle);
    await session.sendMessage({ conversationId: 'ffmpeg-workflow', text: 'Review this cut', modelId: 'test-model' });
    expect(systemText).toContain(FFMPEG_EDITING_WORKFLOW);
  });

  it('shares the same policy with mobile without changing its capabilities', () => {
    const mobile = read('mobile/src/screens/AgentScreen.tsx');
    expect(mobile).toContain('@openvideo/shared/ffmpegEditingWorkflow');
    expect(mobile).toMatch(/FFMPEG_EDITING_WORKFLOW\s*\+\s*'\\n\\n'\s*\+\s*AGENT_SCOPE_POLICY/);
    expect(mobile).toContain('You cannot edit the timeline');
    expect(mobile).toContain('You cannot export');
    expect(FFMPEG_EDITING_WORKFLOW).toContain('42 tools are NOT registered in-app tools');
    expect(FFMPEG_EDITING_WORKFLOW).toContain('An export job ID means started, not completed or verified');
    expect(FFMPEG_EDITING_WORKFLOW).toContain('respecting every approval gate');
    expect(FFMPEG_EDITING_WORKFLOW).toContain('Keep original media unchanged');
    expect(FFMPEG_EDITING_WORKFLOW).toContain('do not promise lossless output');
  });
});
