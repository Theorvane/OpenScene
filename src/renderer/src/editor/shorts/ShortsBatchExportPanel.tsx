import type { ReactElement } from 'react';

import type { ShortsJob } from '../../../../shared/shortsTypes';
import { Button, StatusCard } from '../../ui';
import {
  formatShortsStageLabel,
  type ShortsExportAggregateSummary
} from './shortsReviewState';

type ShortsBatchExportPanelProps = {
  readonly summary: ShortsExportAggregateSummary;
  readonly selectedResultProjectIds: readonly string[];
  readonly isStartingExport: boolean;
  readonly isCancellingExport: boolean;
  readonly exportActionNotice: { readonly tone: 'neutral' | 'success' | 'warning' | 'danger'; readonly text: string } | null;
  readonly activeExportRuns: readonly ShortsJob[];
  readonly onToggleSelectAll: (checked: boolean) => void;
  readonly onToggleItem: (resultProjectId: string, checked: boolean) => void;
  readonly onStartBatchExport: () => void;
  readonly onRetryFailed: () => void;
  readonly onCancelExport: () => void;
  readonly onOpenExportResult: (jobId: string) => void;
  readonly onRevealExportResult: (jobId: string) => void;
};

export function ShortsBatchExportPanel({
  summary,
  selectedResultProjectIds,
  isStartingExport,
  isCancellingExport,
  exportActionNotice,
  activeExportRuns,
  onToggleSelectAll,
  onToggleItem,
  onStartBatchExport,
  onRetryFailed,
  onCancelExport,
  onOpenExportResult,
  onRevealExportResult
}: ShortsBatchExportPanelProps): ReactElement {
  const allSelected =
    summary.readyResultProjectIds.length > 0 &&
    summary.readyResultProjectIds.every((id) => selectedResultProjectIds.includes(id));

  const latestRun = summary.latestExportRun;

  return (
    <section className="shorts-section" data-testid="shorts-export-panel" aria-label="선택 일괄 내보내기">
      <div className="shorts-row">
        <h3 className="shorts-section__title">선택 일괄 Export (1080×1920 · 30fps)</h3>
        {summary.readyResultProjectIds.length > 0 && (
          <label className="shorts-source-bar__group">
            <input
              type="checkbox"
              data-testid="shorts-export-select-all"
              aria-label="Select all materialized shorts for batch export"
              checked={allSelected}
              disabled={summary.isExporting}
              onChange={(event) => onToggleSelectAll(event.currentTarget.checked)}
            />
            <span>전체 ({selectedResultProjectIds.length}/{summary.totalCount})</span>
          </label>
        )}
      </div>

      {summary.items.length === 0 ? (
        <p className="shorts-muted">
          먼저 후보 카드를 선택해 <strong>쇼츠 프로젝트 생성</strong>을 완료하면 여기서 선택 일괄 Export를 실행할 수 있습니다.
        </p>
      ) : (
        <>
          <div className="shorts-nudge-group" role="toolbar" aria-label="일괄 내보내기 제어">
            <Button
              variant="primary"
              data-testid="shorts-export-start-btn"
              disabled={
                selectedResultProjectIds.length === 0 ||
                isStartingExport ||
                summary.isExporting
              }
              onClick={onStartBatchExport}
            >
              {isStartingExport ? '내보내기 시작 중…' : `선택 쇼츠 Export (${selectedResultProjectIds.length}개)`}
            </Button>

            {summary.failedResultProjectIds.length > 0 && (
              <Button
                data-testid="shorts-export-retry-failed-btn"
                disabled={isStartingExport || summary.isExporting}
                onClick={onRetryFailed}
              >
                실패 항목 재시도 ({summary.failedResultProjectIds.length}개)
              </Button>
            )}

            {summary.isExporting && (
              <Button
                variant="stop"
                data-testid="shorts-export-cancel-btn"
                disabled={isCancellingExport || summary.isCancelling}
                onClick={onCancelExport}
              >
                {summary.isCancelling ? '취소 정리 중…' : '일괄 취소'}
              </Button>
            )}
          </div>

          <div className="shorts-row" data-testid="shorts-export-aggregate-status" role="status">
            <span>
              {latestRun === null
                ? '내보내기 대기'
                : `${formatShortsStageLabel(latestRun.stage, latestRun.cleanupComplete)} · 실행 #${activeExportRuns.length} (완료 ${summary.completedCount}/${summary.totalCount})`}
            </span>
            <span>{summary.overallPercent}%</span>
          </div>

          <progress
            data-testid="shorts-export-overall-progress"
            aria-label="Overall batch export progress"
            aria-valuetext={`${summary.overallPercent}%`}
            max={100}
            value={summary.overallPercent}
            style={{ width: '100%' }}
          />

          <div className="shorts-subtitle-list" data-testid="shorts-export-list">
            {summary.items.map((item) => {
              const checked = selectedResultProjectIds.includes(item.resultProjectId);
              const exportState = item.exportJob?.state;
              const fileLabel =
                exportState?.kind === 'completed' ? exportState.fileName : undefined;
              const openJobId = item.completedExportJobId ?? item.activeExportJobId;

              return (
                <div
                  key={item.resultProjectId}
                  className="shorts-export-item"
                  data-testid={`shorts-export-item-${item.resultProjectId}`}
                >
                  <div className="shorts-export-item__top">
                    <input
                      type="checkbox"
                      data-testid={`shorts-export-checkbox-${item.resultProjectId}`}
                      aria-label={`Select short ${item.candidateId} for export`}
                      aria-checked={checked}
                      checked={checked}
                      disabled={summary.isExporting}
                      onChange={(event) => onToggleItem(item.resultProjectId, event.currentTarget.checked)}
                    />
                    <strong>{item.candidateId}</strong>
                    <span
                      className={`shorts-badge ${
                        item.status === 'completed'
                          ? 'shorts-badge--completed'
                          : item.status === 'failed'
                            ? 'shorts-badge--failed'
                            : item.status === 'exporting'
                              ? 'shorts-badge--busy'
                              : 'shorts-badge--ready'
                      }`}
                      data-testid={`shorts-export-item-status-${item.resultProjectId}`}
                    >
                      {item.status === 'ready'
                        ? '대기'
                        : item.status === 'exporting'
                          ? `렌더링 ${item.progressPercent}%`
                          : item.status === 'completed'
                            ? '완료'
                            : item.status === 'cancelled'
                              ? '취소됨'
                              : '실패'}
                    </span>
                  </div>

                  <progress
                    data-testid={`shorts-export-item-progress-${item.resultProjectId}`}
                    aria-label={`Export progress for ${item.candidateId}`}
                    aria-valuetext={`${item.progressPercent}%`}
                    max={100}
                    value={item.progressPercent}
                    style={{ width: '100%' }}
                  />

                  {fileLabel !== undefined && (
                    <span className="shorts-muted">출력 파일: {fileLabel}</span>
                  )}

                  {item.exportJobUnavailable && item.status === 'completed' && (
                    <span className="shorts-muted">
                      이전 앱 세션에서 완료된 내보내기입니다. 새 Export를 실행하면 현재 세션에서 바로 열기/폴더 보기가 가능합니다.
                    </span>
                  )}

                  {item.error !== undefined && (
                    <span
                      className="shorts-muted"
                      role="alert"
                      data-testid={`shorts-export-item-error-${item.resultProjectId}`}
                      style={{ color: 'var(--danger, #ef4444)' }}
                    >
                      {item.error}
                    </span>
                  )}

                  {openJobId !== undefined && item.status === 'completed' && (
                    <div className="shorts-export-item__actions">
                      <Button
                        data-testid={`shorts-export-item-open-${item.resultProjectId}`}
                        disabled={!item.canOpen}
                        onClick={() => onOpenExportResult(openJobId)}
                      >
                        열기
                      </Button>
                      <Button
                        data-testid={`shorts-export-item-reveal-${item.resultProjectId}`}
                        disabled={!item.canReveal}
                        onClick={() => onRevealExportResult(openJobId)}
                      >
                        폴더 보기
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {exportActionNotice !== null && (
        <StatusCard tone={exportActionNotice.tone}>{exportActionNotice.text}</StatusCard>
      )}
      <p className="shorts-muted">
        로컬 FFmpeg 내보내기 전용입니다. 실패 재시도는 기존 성공 파일을 유지한 채 새 실행(parentJobId)을 생성하며, 로컬 경로와 FFmpeg 인자는 노출하지 않습니다.
      </p>
    </section>
  );
}
