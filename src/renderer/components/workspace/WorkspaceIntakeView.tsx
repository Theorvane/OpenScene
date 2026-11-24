import { useState, type DragEvent, type KeyboardEvent, type ReactElement } from 'react';

import { Button, ScrollArea, Textarea } from '../ui';
import type { WorkspaceProjectSummary } from './workspaceTypes';

export interface WorkspaceIntakePreset {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
}

export interface WorkspaceIntakeViewProps {
  readonly prompt: string;
  readonly onPromptChange: (value: string) => void;
  readonly presets: readonly WorkspaceIntakePreset[];
  readonly recentProjects: readonly WorkspaceProjectSummary[];
  readonly selectedFileName?: string | null;
  readonly starting?: boolean;
  readonly errorMessage?: string | null;
  readonly onPickMedia: () => void;
  readonly onFilesDropped?: (files: readonly File[]) => void;
  readonly onStart: () => void;
  readonly onOpenRecentProject: (projectId: string) => void;
}

function UploadIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 10.5V3.5M8 3.5L5.25 6.25M8 3.5L10.75 6.25" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 11.5V12.5C2.5 13.05 2.95 13.5 3.5 13.5H12.5C13.05 13.5 13.5 13.05 13.5 12.5V11.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

export function WorkspaceIntakeView({
  errorMessage = null,
  onFilesDropped,
  onOpenRecentProject,
  onPickMedia,
  onPromptChange,
  onStart,
  presets,
  prompt,
  recentProjects,
  selectedFileName = null,
  starting = false
}: WorkspaceIntakeViewProps): ReactElement {
  const [dragActive, setDragActive] = useState(false);

  const handleDragOver = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    if (!dragActive) setDragActive(true);
  };

  const handleDragLeave = (): void => {
    setDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      onFilesDropped?.(files);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !starting) {
      event.preventDefault();
      onStart();
    }
  };

  return (
    <ScrollArea className="os-ws-intake">
      <div className="os-ws-intake__inner" data-testid="workspace-intake-view">
        <header className="os-ws-intake__header">
          <h1 className="os-ws-intake__title">새 영상 작업 시작</h1>
          <p className="os-ws-intake__subtitle">
            원본 영상을 불러오고 원하는 편집 결과를 자연어로 설명하세요. 원본 파일은 항상 로컬에 그대로 보존됩니다.
          </p>
        </header>

        <button
          type="button"
          className="os-ws-dropzone"
          data-drag-active={dragActive ? 'true' : 'false'}
          data-testid="intake-dropzone"
          onClick={onPickMedia}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <UploadIcon />
          <span className="os-ws-dropzone__title">
            {selectedFileName !== null && selectedFileName.length > 0 ? (
              <span className="os-ui-truncate" style={{ display: 'block', maxWidth: 560 }}>
                선택됨: {selectedFileName}
              </span>
            ) : (
              '영상을 여기에 끌어다 놓거나 클릭해서 선택'
            )}
          </span>
          <span className="os-ws-dropzone__hint">MP4, MOV, MKV, WAV 로컬 파일 지원</span>
        </button>

        <div className="os-ws-intake__composer">
          <Textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="예: 핵심 발언 3구간을 30~45초 9:16 쇼츠 후보로 뽑고 자막 초안을 만들어 주세요."
            error={errorMessage !== null && errorMessage.length > 0}
            data-testid="intake-prompt-input"
          />

          {errorMessage !== null && errorMessage.length > 0 && (
            <div className="os-ui-banner os-ui-banner--danger" role="alert" data-testid="intake-error-banner">
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="os-ws-intake__presets">
            <div className="os-ws-intake__preset-list">
              {presets.map((preset) => (
                <Button
                  key={preset.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => onPromptChange(preset.prompt)}
                  data-testid={`intake-preset-${preset.id}`}
                >
                  {preset.label}
                </Button>
              ))}
            </div>

            <Button
              variant="primary"
              loading={starting}
              disabled={prompt.trim().length === 0 && (selectedFileName === null || selectedFileName.length === 0)}
              onClick={onStart}
              data-testid="intake-start-btn"
            >
              편집 시작
            </Button>
          </div>
        </div>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--os-space-2)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--os-font-size-sm)', fontWeight: 600, color: 'var(--os-ui-fg-secondary)' }}>
            최근 프로젝트
          </h2>

          {recentProjects.length === 0 ? (
            <div className="os-ui-empty-state" data-testid="intake-recent-empty">
              <span>최근 프로젝트가 없습니다. 새 영상을 불러와 첫 편집을 시작하세요.</span>
            </div>
          ) : (
            <table className="os-ws-recent-table" data-testid="intake-recent-table">
              <thead>
                <tr>
                  <th style={{ width: '54%' }}>프로젝트</th>
                  <th style={{ width: '16%' }}>길이</th>
                  <th style={{ width: '14%' }}>쇼츠</th>
                  <th style={{ width: '16%' }}>수정됨</th>
                </tr>
              </thead>
              <tbody>
                {recentProjects.map((project) => (
                  <tr
                    key={project.id}
                    className="os-ws-recent-row"
                    onClick={() => onOpenRecentProject(project.id)}
                  >
                    <td>
                      <button
                        type="button"
                        className="os-ws-recent-row__name-btn os-ui-truncate"
                        title={project.name}
                        data-testid={`recent-project-${project.id}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenRecentProject(project.id);
                        }}
                      >
                        {project.name}
                      </button>
                    </td>
                    <td className="os-ui-tabular-nums" style={{ color: 'var(--os-ui-fg-muted)' }}>
                      {project.durationLabel ?? '—'}
                    </td>
                    <td className="os-ui-tabular-nums" style={{ color: 'var(--os-ui-fg-muted)' }}>
                      {project.shortCount !== undefined ? `${project.shortCount}개` : '—'}
                    </td>
                    <td className="os-ui-tabular-nums" style={{ color: 'var(--os-ui-fg-muted)' }}>
                      {project.updatedAtLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
