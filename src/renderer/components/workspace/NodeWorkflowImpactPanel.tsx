import type { ReactElement, ReactNode } from 'react';

import { Button } from '../ui';
import type { NodeImpactSummary } from './workspaceTypes';

export interface NodeWorkflowImpactPanelProps {
  readonly workflowTitle: string;
  readonly impactSummary: NodeImpactSummary | null;
  readonly applying?: boolean;
  readonly onAutoArrange?: () => void;
  readonly onFitViewport?: () => void;
  readonly onRequestImpactPreview?: () => void;
  readonly onTogglePreserveManualCaptions?: (preserve: boolean) => void;
  readonly onConfirmApply?: () => void;
  readonly onCancelApply?: () => void;
  readonly children: ReactNode;
}

export function NodeWorkflowImpactPanel({
  applying = false,
  children,
  impactSummary,
  onAutoArrange,
  onCancelApply,
  onConfirmApply,
  onFitViewport,
  onRequestImpactPreview,
  onTogglePreserveManualCaptions,
  workflowTitle
}: NodeWorkflowImpactPanelProps): ReactElement {
  return (
    <div className="os-ws-node" data-testid="node-workflow-view">
      <div className="os-ws-node__toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--os-space-2)', minWidth: 0 }}>
          <strong className="os-ui-truncate" style={{ fontSize: 'var(--os-font-size-body)', fontWeight: 600 }}>
            {workflowTitle}
          </strong>
          <span style={{ fontSize: 'var(--os-font-size-xs)', color: 'var(--os-ui-fg-muted)' }}>
            노드(고급)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--os-space-2)' }}>
          {onAutoArrange !== undefined && (
            <Button variant="ghost" size="sm" onClick={onAutoArrange} data-testid="node-auto-arrange-btn">
              자동 정렬
            </Button>
          )}
          {onFitViewport !== undefined && (
            <Button variant="ghost" size="sm" onClick={onFitViewport} data-testid="node-fit-btn">
              화면 맞춤
            </Button>
          )}
          {onRequestImpactPreview !== undefined && (
            <Button
              variant="primary"
              size="sm"
              onClick={onRequestImpactPreview}
              data-testid="node-preview-apply-btn"
            >
              적용 영향 미리보기
            </Button>
          )}
        </div>
      </div>

      <div className="os-ws-node__body">
        <div className="os-ws-node__viewport" data-testid="node-canvas-slot">
          {children}
        </div>

        {impactSummary !== null && (
          <aside className="os-ws-node__impact" aria-label="수동 편집 영향 미리보기" data-testid="node-impact-panel">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--os-space-1)' }}>
              <h2 style={{ margin: 0, fontSize: 'var(--os-font-size-h2)', fontWeight: 600 }} className="os-ui-keep-all">
                수동 편집 영향 미리보기
              </h2>
              <p style={{ margin: 0, fontSize: 'var(--os-font-size-sm)', color: 'var(--os-ui-fg-muted)' }} className="os-ui-keep-all">
                워크플로 “{impactSummary.workflowName}”을(를) 타임라인에 다시 적용하기 전에 변경 범위를 확인하세요.
              </p>
            </div>

            <ul className="os-ws-impact-list" data-testid="node-impact-list">
              {impactSummary.items.map((item) => (
                <li
                  key={item.id}
                  className="os-ws-impact-item"
                  data-category={item.category}
                  data-testid={`node-impact-item-${item.id}`}
                >
                  <div className="os-ws-impact-item__top">
                    <span className="os-ui-keep-all">{item.targetLabel}</span>
                    <span className="os-ws-impact-item__tag">
                      {item.category === 'overwrite' ? '덮어씀' : '유지 가능'}
                    </span>
                  </div>
                  <span className="os-ws-impact-item__detail">{item.detail}</span>
                </li>
              ))}
            </ul>

            <label className="os-ws-checkbox-row">
              <input
                type="checkbox"
                checked={impactSummary.preserveManualCaptions}
                data-testid="node-preserve-captions-checkbox"
                onChange={(event) => onTogglePreserveManualCaptions?.(event.target.checked)}
              />
              <span>수동 수정 자막 유지</span>
            </label>

            <div className="os-ui-banner os-ui-banner--info" data-testid="node-undo-guarantee">
              <span>
                {impactSummary.undoGuaranteeLabel ??
                  '적용 후에도 단일 실행 취소(Undo) 한 번으로 직전 타임라인으로 되돌릴 수 있습니다.'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--os-space-2)', marginTop: 'auto' }}>
              <Button
                variant="ghost"
                size="sm"
                disabled={applying}
                onClick={onCancelApply}
                data-testid="node-impact-cancel-btn"
              >
                취소
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={applying}
                onClick={onConfirmApply}
                data-testid="node-impact-confirm-btn"
              >
                타임라인에 적용
              </Button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
