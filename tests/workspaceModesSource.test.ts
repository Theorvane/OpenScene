import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string): string => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

describe('workspace integration contracts', () => {
  it('opens the editing surface on desktop and mobile', () => {
    expect(source('src/renderer/src/App.tsx')).toContain('<TimelineEditor editor={editor}');
    expect(source('mobile/App.tsx')).toContain('<CanvasScreen projectId={route.projectId}');
  });

  it('retains mobile studios within one project, hides them from accessibility, and pauses hidden editing', () => {
    const app = source('mobile/App.tsx');
    for (const tab of ['edit']) {
      expect(app).toContain(`<RetainedScreen active={tab === '${tab}'}>`);
    }
    expect(app).toContain('key={route.projectId}');
    expect(app).toContain("importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}");
    expect(source('mobile/src/screens/EditScreen.tsx')).toContain('if (!active) setPlaying(false)');
    expect(source('mobile/src/screens/EditScreen.tsx')).toContain('if (loadedSnapshot.current === snapshot) return');
  });

  it('opens the editor only after successful placement', () => {
    expect(source('mobile/src/screens/LibraryScreen.tsx')).toContain('if (placed) onOpenEditor?.()');
    expect(source('src/renderer/src/VideoGenerationWorkspace.tsx')).toContain('if (placed) onOpenEditor?.()');
  });

  it('observes background generation completion without reloading its own edits', () => {
    const editor = source('mobile/src/screens/EditScreen.tsx');
    expect(editor).toContain('const observedProject = useProject(projectId)');
    expect(editor).toContain('[projectId, loadProject, reloadToken, active, observedProject]');
    const markOwnEdit = editor.indexOf('loadedSnapshot.current = JSON.stringify([timeline, project.assets])');
    const publishEdit = editor.indexOf('writeProject({ ...project, timeline })');
    expect(markOwnEdit).toBeGreaterThan(-1);
    expect(markOwnEdit).toBeLessThan(publishEdit);
  });
});
