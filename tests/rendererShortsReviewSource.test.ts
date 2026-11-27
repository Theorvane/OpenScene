import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspaceSource = readFileSync(
  new URL('../src/renderer/src/editor/shorts/ShortsReviewWorkspace.tsx', import.meta.url),
  'utf8'
);
const previewSource = readFileSync(
  new URL('../src/renderer/src/editor/shorts/ShortsCandidatePreview.tsx', import.meta.url),
  'utf8'
);
const editorPanelSource = readFileSync(
  new URL('../src/renderer/src/editor/shorts/ShortsResultEditor.tsx', import.meta.url),
  'utf8'
);
const exportPanelSource = readFileSync(
  new URL('../src/renderer/src/editor/shorts/ShortsBatchExportPanel.tsx', import.meta.url),
  'utf8'
);
const timelineEditorSource = readFileSync(
  new URL('../src/renderer/src/editor/TimelineEditor.tsx', import.meta.url),
  'utf8'
);
const allShortsUiSource = `${workspaceSource}\n${previewSource}\n${editorPanelSource}\n${exportPanelSource}`;

describe('renderer shorts review UI source & CUA contract', () => {
  it('uses only typed window.videoTool APIs and never exposes ipcRenderer or local paths/argv', () => {
    expect(workspaceSource).toContain('window.videoTool.shortsStart');
    expect(workspaceSource).toContain('window.videoTool.shortsGet');
    expect(workspaceSource).toContain('window.videoTool.shortsList');
    expect(workspaceSource).toContain('window.videoTool.shortsCancel');
    expect(workspaceSource).toContain('window.videoTool.shortsMaterialize');
    expect(workspaceSource).toContain('window.videoTool.shortsExport');
    expect(workspaceSource).toContain('window.videoTool.getExportJob');
    expect(workspaceSource).toContain('window.videoTool.openExportResult');
    expect(workspaceSource).toContain('window.videoTool.revealExportResult');
    expect(workspaceSource).toContain('window.videoTool.openProject');
    expect(workspaceSource).toContain('window.videoTool.saveTimeline');

    expect(allShortsUiSource).not.toContain('ipcRenderer');
    expect(allShortsUiSource).not.toMatch(/\boutputPath\b|\bexecutablePath\b|\bargv\b/);
  });

  it('refreshes project list before opening materialized resultProjectId and saves on return', () => {
    expect(timelineEditorSource).toContain("mode === 'natural' ? 'shorts' : 'timeline'");
    expect(timelineEditorSource).not.toContain("'shorts-review' : undefined");
    expect(timelineEditorSource).toContain('await editor.refreshProjects()');
    expect(timelineEditorSource).toContain("writeExportFramePreference(request.resultProjectId, 'portrait')");
    expect(timelineEditorSource).toContain('data-testid="shorts-return-banner"');
    expect(timelineEditorSource).toContain('data-testid="shorts-return-to-review-btn"');
    expect(timelineEditorSource).toContain('editor.hasUnsavedTimeline && !(await editor.saveTimeline())');
  });

  it('exposes stable CUA data-testid selectors, ARIA semantics, pointer drag, and keyboard contracts', () => {
    for (const selector of [
      'data-testid="shorts-review-workspace"',
      'data-testid="shorts-import-video-btn"',
      'data-testid="shorts-source-select"',
      'data-testid="shorts-start-btn"',
      'data-testid="shorts-cancel-btn"',
      'data-testid="shorts-stage-status"',
      'data-testid="shorts-cleanup-status"',
      'data-testid="shorts-error-banner"',
      'data-testid="shorts-open-settings-btn"',
      'data-testid="shorts-insufficient-evidence-banner"',
      'data-testid="shorts-candidate-list"',
      'data-testid="shorts-materialize-btn"',
      'data-testid="shorts-crop-viewport"',
      'data-testid="shorts-preview-fit-badge"',
      'data-testid="shorts-preview-play-btn"',
      'data-testid="shorts-preview-scrub-slider"',
      'data-testid="shorts-recipe-meta"',
      'data-testid="shorts-save-result-btn"',
      'data-testid="shorts-reload-result-btn"',
      'data-testid="shorts-trim-start-input"',
      'data-testid="shorts-trim-end-input"',
      'data-testid="shorts-crop-offset-x-input"',
      'data-testid="shorts-crop-offset-y-input"',
      'data-testid="shorts-crop-scale-input"',
      'data-testid="shorts-crop-reset-btn"',
      'data-testid="shorts-subtitle-list"',
      'data-testid="shorts-subtitle-add-btn"',
      'data-testid="shorts-export-panel"',
      'data-testid="shorts-export-start-btn"',
      'data-testid="shorts-export-retry-failed-btn"',
      'data-testid="shorts-export-cancel-btn"',
      'data-testid="shorts-export-overall-progress"'
    ]) {
      expect(allShortsUiSource).toContain(selector);
    }

    expect(previewSource).toContain('setPointerCapture');
    expect(previewSource).toContain('stepShortsTransformByKey');
    expect(previewSource).toContain('role="application"');
    expect(previewSource).toContain('aria-valuetext=');
    expect(workspaceSource).toContain('role="listbox"');
    expect(workspaceSource).toContain('role="option"');
    expect(workspaceSource).toContain('SHORTS_FIT_LABEL');
    expect(editorPanelSource).toContain('얼굴추적 미포함');
    expect(editorPanelSource).toContain('data-dirty=');
    expect(editorPanelSource).toContain('data-saving=');
    expect(editorPanelSource).toContain('step={1}');
    expect(workspaceSource).toContain('mountedRef');
    expect(workspaceSource).toContain('resultRevisionByIdRef');
    expect(workspaceSource).toContain('latestLoadRevByIdRef');
    expect(workspaceSource).toContain('canApplyResultAsyncResponse');
  });
});
