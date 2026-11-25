import { useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';

import { Button, Input, ScrollArea, Textarea } from '../ui';
import {
  formatTimecodeSec,
  type WorkspaceApprovalRequest,
  type WorkspaceCandidateItem,
  type WorkspaceExportStatus,
  type WorkspaceStepItem,
  type WorkspaceTurn
} from './workspaceTypes';

export interface NaturalStudioViewProps {
  readonly turns: readonly WorkspaceTurn[];
  readonly steps: readonly WorkspaceStepItem[];
  readonly approval: WorkspaceApprovalRequest | null;
  readonly onApprove?: (approvalId: string) => void;
  readonly onDeny?: (approvalId: string) => void;
  readonly candidates: readonly WorkspaceCandidateItem[];
  readonly selectedCandidateId: string | null;
  readonly onSelectCandidate: (candidateId: string) => void;
  readonly onToggleCandidate: (candidateId: string, checked: boolean) => void;
  readonly exportStatus: WorkspaceExportStatus;
  readonly onExportSelected: () => void;
  readonly onRetryExport?: () => void;
  readonly onRetryFailedExport?: (failedIds: readonly string[]) => void;
  readonly composerValue: string;
  readonly onComposerChange: (value: string) => void;
  readonly onComposerSubmit: () => void;
  readonly composerLoading?: boolean;
  readonly composerDisabled?: boolean;
  readonly previewSlot?: ReactNode;
  readonly miniTimelineSlot?: ReactNode;
  readonly onUpdateCandidateRange?: (candidateId: string, range: { readonly startSec: number; readonly endSec: number }) => void;
  readonly onUpdateCandidateTransform?: (
    candidateId: string,
    transform: { readonly scalePercent: number; readonly offsetXPercent: number }
  ) => void;
  readonly onResetContain?: (candidateId: string) => void;
  readonly onUpdateCandidateCaption?: (candidateId: string, caption: string) => void;
  readonly onOpenPrecisionTab?: () => void;
}

function stepDotClass(status: WorkspaceStepItem['status']): string {
  switch (status) {
    case 'done':
      return 'os-ws-dot os-ws-dot--ok';
    case 'running':
      return 'os-ws-dot os-ws-dot--info';
    case 'error':
      return 'os-ws-dot os-ws-dot--danger';
    default:
      return 'os-ws-dot';
  }
}

export function NaturalStudioView({
  approval,
  candidates,
  composerDisabled = false,
  composerLoading = false,
  composerValue,
  exportStatus,
  miniTimelineSlot,
  onApprove,
  onComposerChange,
  onComposerSubmit,
  onDeny,
  onExportSelected,
  onOpenPrecisionTab,
  onResetContain,
  onRetryExport,
  onRetryFailedExport,
  onSelectCandidate,
  onToggleCandidate,
  onUpdateCandidateCaption,
  onUpdateCandidateRange,
  onUpdateCandidateTransform,
  previewSlot,
  selectedCandidateId,
  steps,
  turns
}: NaturalStudioViewProps): ReactElement {
  const [miniTimelineOpen, setMiniTimelineOpen] = useState(false);

  const selectedCandidate = candidates.find((item) => item.id === selectedCandidateId) ?? null;
  const checkedCandidates = candidates.filter((item) => item.selected);

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.key === 'Process') {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!composerDisabled && !composerLoading && composerValue.trim().length > 0) {
        onComposerSubmit();
      }
    }
  };

  return (
    <div className="os-ws-natural" data-testid="natural-studio-view">
      <div className="os-ws-natural__stream-col">
        <ScrollArea className="os-ws-natural__scroll">
          <div className="os-ws-natural__stream-inner">
            {turns.length > 0 && (
              <div className="os-ws-thread" data-testid="natural-thread">
                {turns.map((turn) => (
                  <article
                    key={turn.id}
                    className={turn.role === 'user' ? 'os-ws-turn--user' : 'os-ws-turn--assistant'}
                    data-role={turn.role}
                  >
                    <div className="os-ws-turn__meta">
                      <span>{turn.role === 'user' ? '요청' : 'OpenScene'}</span>
                      {turn.timestampLabel !== undefined && (
                        <span className="os-ui-tabular-nums">{turn.timestampLabel}</span>
                      )}
                    </div>
                    <div>{turn.content}</div>
                  </article>
                ))}
              </div>
            )}

            {steps.length > 0 && (
              <div className="os-ws-steps" aria-label="진행 단계" data-testid="natural-step-trail">
                {steps.map((step) => (
                  <div key={step.id} className="os-ws-step" data-status={step.status}>
                    <span className={stepDotClass(step.status)} aria-hidden="true" />
                    <span className="os-ui-keep-all">{step.label}</span>
                    {step.detail !== undefined && (
                      <span className="os-ui-tabular-nums" style={{ color: 'var(--os-ui-fg-faint)', marginLeft: 'auto' }}>
                        {step.detail}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {approval !== null && (
              <section className="os-ws-approval" aria-label="작업 승인 요청" data-testid="natural-approval-card">
                <h3 className="os-ws-approval__title">{approval.title}</h3>
                <p className="os-ws-approval__summary">{approval.summary}</p>
                {approval.riskNote !== undefined && (
                  <p className="os-ws-approval__summary" style={{ color: 'var(--os-ui-fg-muted)', fontSize: 'var(--os-font-size-sm)' }}>
                    {approval.riskNote}
                  </p>
                )}

                <div className="os-ws-approval__actions">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => onApprove?.(approval.id)}
                    data-testid="approval-approve-btn"
                  >
                    {approval.actionLabel ?? '승인하고 실행'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeny?.(approval.id)}
                    data-testid="approval-deny-btn"
                  >
                    거절
                  </Button>
                </div>

                <details className="os-ws-approval__details" data-testid="approval-tech-details">
                  <summary>기술 메타데이터 보기</summary>
                  <div className="os-ws-approval__tech-grid">
                    <span>frameId</span>
                    <span className="os-ui-truncate">{approval.technical.frameId}</span>
                    <span>layoutRevision</span>
                    <span>{approval.technical.layoutRevision}</span>
                    <span>contentRevision</span>
                    <span>{approval.technical.contentRevision}</span>
                    <span>snapshotId</span>
                    <span className="os-ui-truncate">{approval.technical.snapshotId}</span>
                    <span>timelineDigest</span>
                    <span className="os-ui-truncate">{approval.technical.timelineDigest}</span>
                  </div>
                </details>
              </section>
            )}

            <section className="os-ws-candidates" aria-label="쇼츠 후보 목록">
              <div className="os-ws-candidates__header">
                <h3 className="os-ws-candidates__heading">
                  쇼츠 후보 (<span className="os-ui-tabular-nums">{candidates.length}</span>)
                </h3>
                <span className="os-ui-tabular-nums" style={{ fontSize: 'var(--os-font-size-xs)', color: 'var(--os-ui-fg-muted)' }}>
                  선택됨 {checkedCandidates.length}건
                </span>
              </div>

              {candidates.length === 0 ? (
                <div className="os-ui-empty-state" data-testid="candidates-empty-state">
                  <strong style={{ color: 'var(--os-ui-fg)', fontWeight: 600 }}>선정된 쇼츠 후보가 없습니다</strong>
                  <span>아래 입력창에서 원하는 편집 기준을 입력해 후보 추출을 시작하세요.</span>
                </div>
              ) : (
                candidates.map((candidate) => {
                  const durationSec = Math.max(0, Math.round(candidate.endSec - candidate.startSec));
                  const isSelected = candidate.id === selectedCandidateId;
                  return (
                    <div
                      key={candidate.id}
                      role="button"
                      tabIndex={0}
                      className="os-ws-candidate-row"
                      data-selected={isSelected ? 'true' : 'false'}
                      data-testid={`candidate-row-${candidate.id}`}
                      onClick={() => onSelectCandidate(candidate.id)}
                      onKeyDown={(event) => {
                        if (
                          event.target !== event.currentTarget &&
                          event.target instanceof Element &&
                          event.target.closest(
                            'input, button, textarea, select, a, label, [role="checkbox"], [role="button"]'
                          ) !== null
                        ) {
                          return;
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectCandidate(candidate.id);
                        }
                      }}
                    >
                      <input
                        type="checkbox"
                        className="os-ws-candidate-row__check"
                        checked={candidate.selected}
                        aria-label={`${candidate.title} 내보내기 포함`}
                        data-testid={`candidate-checkbox-${candidate.id}`}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => onToggleCandidate(candidate.id, event.target.checked)}
                      />
                      <div className="os-ws-candidate-row__body">
                        <div className="os-ws-candidate-row__top">
                          <span className="os-ws-candidate-row__title os-ui-truncate">
                            {candidate.index}. {candidate.title}
                          </span>
                          <span className="os-ws-candidate-row__time">
                            {formatTimecodeSec(candidate.startSec)}–{formatTimecodeSec(candidate.endSec)} ({durationSec}s)
                          </span>
                        </div>
                        <span className="os-ws-candidate-row__reason">{candidate.reason}</span>
                        <span className="os-ws-candidate-row__caption os-ui-truncate">
                          자막: {candidate.caption}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </section>

            <section className="os-ws-export-bar" aria-label="일괄 내보내기" data-testid="batch-export-bar">
              <div className="os-ws-export-bar__row">
                <span className="os-ui-tabular-nums" style={{ fontSize: 'var(--os-font-size-sm)', color: 'var(--os-ui-fg-secondary)' }}>
                  일괄 MP4 내보내기 · 선택 {checkedCandidates.length}개
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  loading={exportStatus.kind === 'loading'}
                  disabled={checkedCandidates.length === 0 || exportStatus.kind === 'loading'}
                  onClick={onExportSelected}
                  data-testid="batch-export-btn"
                >
                  {exportStatus.kind === 'loading'
                    ? `내보내는 중 (${exportStatus.completedCount}/${exportStatus.totalCount})`
                    : '선택 항목 내보내기'}
                </Button>
              </div>

              {exportStatus.kind === 'loading' && (
                <div className="os-ui-banner os-ui-banner--info os-ui-tabular-nums" data-testid="export-status-loading">
                  <span>
                    {exportStatus.message ??
                      `FFmpeg 렌더링 진행 중 (${exportStatus.completedCount}/${exportStatus.totalCount})`}
                  </span>
                </div>
              )}

              {exportStatus.kind === 'done' && (
                <div className="os-ui-banner os-ui-banner--ok os-ui-tabular-nums" data-testid="export-status-done">
                  <span>
                    {exportStatus.summary ??
                      `완료: ${exportStatus.completedCount}/${exportStatus.totalCount}개 MP4 내보내기 성공`}
                  </span>
                </div>
              )}

              {exportStatus.kind === 'partial_error' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--os-space-2)' }} data-testid="export-status-partial-error">
                  <div className="os-ui-banner os-ui-banner--warn os-ui-tabular-nums">
                    <span>
                      부분 실패: 성공 {exportStatus.completedIds.length}개 보존됨 · 실패 {exportStatus.failedItems.length}개
                    </span>
                    {onRetryFailedExport !== undefined && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => onRetryFailedExport(exportStatus.failedItems.map((item) => item.id))}
                        data-testid="export-retry-failed-btn"
                      >
                        실패 항목만 재시도
                      </Button>
                    )}
                  </div>
                  <pre className="os-ws-export-raw-error" data-testid="export-raw-error">
                    {exportStatus.rawError}
                  </pre>
                </div>
              )}

              {exportStatus.kind === 'error' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--os-space-2)' }} data-testid="export-status-error">
                  <div className="os-ui-banner os-ui-banner--danger" role="alert">
                    <span>내보내기 실패</span>
                    {onRetryExport !== undefined && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={onRetryExport}
                        data-testid="export-retry-btn"
                      >
                        다시 시도
                      </Button>
                    )}
                  </div>
                  <pre className="os-ws-export-raw-error" data-testid="export-raw-error">
                    {exportStatus.rawError}
                  </pre>
                </div>
              )}
            </section>
          </div>
        </ScrollArea>

        {miniTimelineSlot !== undefined && (
          <div className="os-ws-mini-timeline">
            <div className="os-ws-mini-timeline__bar">
              <span style={{ fontSize: 'var(--os-font-size-xs)', color: 'var(--os-ui-fg-muted)' }}>미니 타임라인</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMiniTimelineOpen((open) => !open)}
                data-testid="mini-timeline-toggle-btn"
              >
                {miniTimelineOpen ? '접기' : '펼치기'}
              </Button>
            </div>
            {miniTimelineOpen && <div className="os-ws-mini-timeline__slot">{miniTimelineSlot}</div>}
          </div>
        )}

        <div className="os-ws-composer">
          <div className="os-ws-composer__inner">
            <Textarea
              className="os-ws-composer__input"
              rows={1}
              value={composerValue}
              disabled={composerDisabled}
              placeholder="편집 지시를 자연어로 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"
              onChange={(event) => onComposerChange(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              data-testid="natural-composer-input"
            />
            <Button
              variant="primary"
              loading={composerLoading}
              disabled={composerDisabled || composerValue.trim().length === 0}
              onClick={onComposerSubmit}
              data-testid="natural-composer-submit"
            >
              전송
            </Button>
          </div>
        </div>
      </div>

      <aside className="os-ws-inspector" aria-label="미리보기 및 빠른 편집">
        <ScrollArea className="os-ws-sidebar__scroll">
          <div className="os-ws-inspector__inner">
            <div className="os-ws-preview-box" data-testid="natural-preview-slot">
              {previewSlot !== undefined ? (
                previewSlot
              ) : (
                <>
                  <span style={{ fontSize: 'var(--os-font-size-sm)', color: 'var(--os-ui-fg-secondary)' }}>
                    {selectedCandidate !== null ? selectedCandidate.title : '미리보기 대기 중'}
                  </span>
                  <span className="os-ui-tabular-nums" style={{ fontSize: 'var(--os-font-size-xs)', color: 'var(--os-ui-fg-faint)' }}>
                    {selectedCandidate !== null
                      ? `${formatTimecodeSec(selectedCandidate.startSec)}–${formatTimecodeSec(selectedCandidate.endSec)} · ${
                          selectedCandidate.fitMode === 'contain' ? '9:16 Contain' : `수동 ${selectedCandidate.scalePercent}%`
                        }`
                      : '후보를 선택하면 미리보기가 표시됩니다'}
                  </span>
                </>
              )}
            </div>

            {selectedCandidate === null ? (
              <div className="os-ui-empty-state" data-testid="inspector-empty-state">
                <span>왼쪽 목록에서 쇼츠 후보를 선택하면 구간·프레이밍·자막을 바로 다듬을 수 있습니다.</span>
              </div>
            ) : (
              <>
                <div className="os-ws-inspector__section">
                  <div className="os-ws-inspector__label">
                    <span>구간 다듬기 (초)</span>
                    <span className="os-ui-tabular-nums">
                      {formatTimecodeSec(selectedCandidate.startSec)}–{formatTimecodeSec(selectedCandidate.endSec)}
                    </span>
                  </div>
                  <div className="os-ws-inspector__grid-2">
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 'var(--os-font-size-xs)', color: 'var(--os-ui-fg-muted)' }}>시작</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        value={selectedCandidate.startSec}
                        data-testid="inspector-start-sec"
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next) && next >= 0) {
                            onUpdateCandidateRange?.(selectedCandidate.id, {
                              startSec: next,
                              endSec: Math.max(next + 1, selectedCandidate.endSec)
                            });
                          }
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 'var(--os-font-size-xs)', color: 'var(--os-ui-fg-muted)' }}>종료</span>
                      <Input
                        type="number"
                        min={1}
                        step={0.5}
                        value={selectedCandidate.endSec}
                        data-testid="inspector-end-sec"
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next) && next > selectedCandidate.startSec) {
                            onUpdateCandidateRange?.(selectedCandidate.id, {
                              startSec: selectedCandidate.startSec,
                              endSec: next
                            });
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div className="os-ws-inspector__section">
                  <div className="os-ws-inspector__label">
                    <span>9:16 프레이밍</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onResetContain?.(selectedCandidate.id)}
                      data-testid="inspector-reset-contain-btn"
                    >
                      Contain 초기화
                    </Button>
                  </div>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="os-ws-inspector__label">
                      <span>확대 비율</span>
                      <span className="os-ui-tabular-nums">{selectedCandidate.scalePercent}%</span>
                    </span>
                    <input
                      type="range"
                      className="os-ws-slider"
                      min={100}
                      max={220}
                      step={5}
                      value={selectedCandidate.scalePercent}
                      data-testid="inspector-scale-slider"
                      onChange={(event) =>
                        onUpdateCandidateTransform?.(selectedCandidate.id, {
                          scalePercent: Number(event.target.value),
                          offsetXPercent: selectedCandidate.offsetXPercent
                        })
                      }
                    />
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="os-ws-inspector__label">
                      <span>가로 오프셋 (X)</span>
                      <span className="os-ui-tabular-nums">{selectedCandidate.offsetXPercent}%</span>
                    </span>
                    <input
                      type="range"
                      className="os-ws-slider"
                      min={-100}
                      max={100}
                      step={5}
                      value={selectedCandidate.offsetXPercent}
                      data-testid="inspector-offsetx-slider"
                      onChange={(event) =>
                        onUpdateCandidateTransform?.(selectedCandidate.id, {
                          scalePercent: selectedCandidate.scalePercent,
                          offsetXPercent: Number(event.target.value)
                        })
                      }
                    />
                  </label>
                </div>

                <div className="os-ws-inspector__section">
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="os-ws-inspector__label">
                      <span>자막 편집</span>
                    </span>
                    <Textarea
                      value={selectedCandidate.caption}
                      data-testid="inspector-caption-textarea"
                      onChange={(event) => onUpdateCandidateCaption?.(selectedCandidate.id, event.target.value)}
                    />
                  </label>
                </div>

                {onOpenPrecisionTab !== undefined && (
                  <Button
                    variant="default"
                    onClick={onOpenPrecisionTab}
                    data-testid="inspector-open-precision-btn"
                  >
                    정밀 탭 →
                  </Button>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </aside>
    </div>
  );
}
