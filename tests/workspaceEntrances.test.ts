import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WORKSPACE_EXPERIENCES, WORKSPACE_MODES, workspaceModeForTab } from '../src/shared/workspaceModes';

describe('product workspace entrances', () => {
  it.each(WORKSPACE_MODES)('%s opens its own workspace', mode => {
    const experience = WORKSPACE_EXPERIENCES[mode];
    expect(workspaceModeForTab(experience.entryTab)).toBe(mode);
    expect(experience.description.length).toBeGreaterThan(10);
    expect(experience.tools.length).toBeGreaterThan(10);
  });
  it('uses the saved project type when opening a card and the selected type for new projects', () => {
    const desktop = readFileSync('src/renderer/src/ProjectsPage.tsx', 'utf8');
    const mobile = readFileSync('mobile/src/screens/ProjectsScreen.tsx', 'utf8');
    expect(desktop).toContain("onOpenProject?.(item.id, 'edit')");
    expect(desktop).toContain("onOpenProjectFolder?.('edit')");
    expect(mobile).toContain("onOpen(project.id, 'edit')");
    for (const source of [desktop, mobile]) {
      expect(source).not.toContain('Choose a project type');
      expect(source).not.toContain('aiGenerateVideo(');
    }
  });
});
