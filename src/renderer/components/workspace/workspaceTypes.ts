export type WorkspaceTabMode = 'natural' | 'precision' | 'node';
export type WorkspaceMode = WorkspaceTabMode | 'intake';

export interface WorkspaceProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAtLabel: string;
  readonly durationLabel?: string;
  readonly resolutionLabel?: string;
  readonly shortCount?: number;
  readonly sourceFileName?: string;
}


export interface WorkspaceSafetyState {
  readonly sourcePreserved: boolean;
  readonly dirty: boolean;
  readonly saving?: boolean;
  readonly pendingApprovalCount: number;
}

export type WorkspaceCandidateStatus = 'ready' | 'exporting' | 'completed' | 'failed';
export type WorkspaceFitMode = 'contain' | 'manual';

export interface WorkspaceCandidateItem {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly startSec: number;
  readonly endSec: number;
  readonly reason: string;
  readonly caption: string;
  readonly selected: boolean;
  readonly fitMode: WorkspaceFitMode;
  readonly scalePercent: number;
  readonly offsetXPercent: number;
  readonly status?: WorkspaceCandidateStatus;
  readonly error?: string;
}

export interface WorkspaceTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly timestampLabel?: string;
}

export type WorkspaceStepStatus = 'pending' | 'running' | 'done' | 'error';

export interface WorkspaceStepItem {
  readonly id: string;
  readonly label: string;
  readonly status: WorkspaceStepStatus;
  readonly detail?: string;
}

export interface WorkspaceApprovalTechnicalMetadata {
  readonly frameId: string;
  readonly layoutRevision: number;
  readonly contentRevision: number;
  readonly snapshotId: string;
  readonly timelineDigest: string;
}

export interface WorkspaceApprovalRequest {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly actionLabel?: string;
  readonly riskNote?: string;
  readonly technical: WorkspaceApprovalTechnicalMetadata;
}

export interface WorkspaceFailedExportItem {
  readonly id: string;
  readonly title: string;
  readonly error: string;
}

export type WorkspaceExportStatus =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'loading';
      readonly completedCount: number;
      readonly totalCount: number;
      readonly message?: string;
    }
  | {
      readonly kind: 'done';
      readonly completedCount: number;
      readonly totalCount: number;
      readonly summary?: string;
    }
  | {
      readonly kind: 'partial_error';
      readonly completedIds: readonly string[];
      readonly failedItems: readonly WorkspaceFailedExportItem[];
      readonly rawError: string;
    }
  | {
      readonly kind: 'error';
      readonly rawError: string;
    };

export type NodeImpactCategory = 'overwrite' | 'preservable';

export interface NodeImpactItem {
  readonly id: string;
  readonly targetLabel: string;
  readonly category: NodeImpactCategory;
  readonly detail: string;
}

export interface NodeImpactSummary {
  readonly workflowName: string;
  readonly items: readonly NodeImpactItem[];
  readonly preserveManualCaptions: boolean;
  readonly undoGuaranteeLabel?: string;
}

export function formatTimecodeSec(seconds: number): string {
  const clamped = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}
