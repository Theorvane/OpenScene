import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { FFMPEG_EDITING_WORKFLOW } from '../src/shared/ffmpegEditingWorkflow';
import { buildAgentChatGraph } from '../src/main/agentChatGraph';
import { AgentChatSessionManager } from '../src/main/agentChatSession';

const adapter = resolve(process.cwd(), '.agents/skills/ffmpeg-skill');
const root = resolve(process.cwd(), 'external/ffmpeg-skill');
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(adapter, 'UPSTREAM.json'), 'utf8')) as {
  path: string; integration: string; repository: string; commit: string; version: string; files: Record<string, string>;
};

describe('pinned ffmpeg-skill integration', () => {
  it('preserves the upstream snapshot and license', () => {
    expect(manifest.repository).toBe('https://github.com/kajisho5/ffmpeg-skill');
    expect(manifest.commit).toBe('3145261a1c19f399b9520fad7fdac741871e1426');
    expect(manifest.version).toBe('3.13.1');
    expect(manifest.path).toBe('external/ffmpeg-skill');
    expect(manifest.integration).toBe('git-submodule');
    const modules = read('.gitmodules');
    expect(modules).toContain('path = external/ffmpeg-skill');
    expect(modules).toContain('url = https://github.com/kajisho5/ffmpeg-skill.git');
    expect(readFileSync(resolve(adapter, 'SKILL.md'), 'utf8')).toContain('external/ffmpeg-skill/SKILL.md');
    expect(Object.keys(manifest.files).length).toBeGreaterThan(60);
    for (const [path, expected] of Object.entries(manifest.files)) {
      expect(path).not.toMatch(/^\/|\.\./);
      expect(createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex'), path).toBe(expected);
    }
    expect(readFileSync(resolve(root, 'LICENSE'), 'utf8')).toContain('Copyright (c) 2026 kajisho5');
    expect(read('THIRD_PARTY_NOTICES.md')).toContain('kajisho5/ffmpeg-skill');
  });

  it('includes the complete pinned tools without wiring the external installer into the app', () => {
    const tools = readdirSync(resolve(root, 'scripts')).filter((name) => name.endsWith('.py') && !name.startsWith('_'));
    expect(tools).toHaveLength(42);
    expect(manifest.files).toHaveProperty('mcp/server.py');
    expect(manifest.files).toHaveProperty('references/workflow.md');
    expect(manifest.files).toHaveProperty('docs/contract.md');
    // git archive omits .git; the complete manifest above remains mandatory there.
    // Do not let git walk up to a parent checkout and compare its unrelated HEAD.
    if (existsSync(resolve(root, '.git'))) {
      expect(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(manifest.commit);
    } else {
      expect(existsSync(resolve(process.cwd(), '.git')), 'initialize the FFmpeg skill submodule in Git checkouts').toBe(false);
    }
    expect(read('UPSTREAM_PINS.md')).toContain(manifest.commit);
    const appPackage = JSON.parse(read('package.json'));
    expect(appPackage.dependencies).not.toHaveProperty('ffmpeg-skill');
    expect(appPackage.scripts).not.toHaveProperty('postinstall');
  });

  it('includes the pinned payload in the Git-free media verification snapshot', () => {
    const snapshot = read('scripts/verify-media-analysis.ps1');
    expect(snapshot).toContain("rev-parse 'HEAD:external/ffmpeg-skill'");
    expect(snapshot).toContain("'external/ffmpeg-skill') archive $skillCommit");
    expect(snapshot).toContain('verification-ffmpeg-skill.tar');
    const verification = read('scripts/media-analysis/verify.sh');
    expect(verification).toContain('tar -xf /input/.local-runtimes/verification-ffmpeg-skill.tar -C /work/project/external/ffmpeg-skill');
    expect(verification).toContain('python3 external/ffmpeg-skill/scripts/probe.py');
    expect(verification).toContain('python3 external/ffmpeg-skill/scripts/look.py');
    expect(verification).not.toContain('.agents/skills/ffmpeg-skill/scripts/');
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
    expect(systemText).toContain('42 tools are NOT registered in-app tools');
    expect(systemText).toContain('An export job ID means started, not completed or verified');
    expect(systemText).toContain('respecting every approval gate');
    expect(systemText).toContain('Keep original media unchanged');
    expect(systemText).toContain('do not promise lossless output');
  });

});
