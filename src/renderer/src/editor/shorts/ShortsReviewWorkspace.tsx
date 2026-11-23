import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement
} from 'react';

import type { LocalExportJob } from '../../../../shared/exportTypes';
import { resolveOpenAiAuthMode } from '../../../../shared/openAiAuth';
import type { ShortsJob } from '../../../../shared/shortsTypes';
import type { ClipEffects, LocalProjectSnapshot, TimelineDocument } from '../../../../shared/timelineTypes';
import { useAgentChat } from '../../AgentChatContext';
import { AgentModelPicker } from '../../AgentModelPicker';
import { useAiDomainModel } from '../../AiDomainModelContext';
import { useChatGptAuth } from '../../ChatGptAuthContext';
import { useLlmModel } from '../../LlmProviderContext';
import { errorMessage } from '../../appTypes';
import { formatDuration } from '../../format';
import { Button, StatusCard } from '../../ui';
import type { TimelineEditorController } from '../useTimelineEditor';
import { ShortsBatchExportPanel } from './ShortsBatchExportPanel';
import { ShortsCandidatePreview } from './ShortsCandidatePreview';
import { ShortsResultEditor } from './ShortsResultEditor';
import {
  SHORTS_COUNT_MAX,
  SHORTS_COUNT_MIN,
  SHORTS_DEFAULT_COUNT,
  SHORTS_FIT_LABEL,
  SHORTS_MAX_DURATION_MS_DEFAULT,
  SHORTS_MIN_DURATION_MS_DEFAULT,
  aggregateShortsExports,
  filterSourceCaptionsForCandidate,
  findRecipeForCandidate,
  formatShortsStageLabel,
  getPrimaryShortsClip,
  getShortsErrorGuidance,
  getShortsSelectionNotice,
  groupShortsRuns,
  isShortsJobBusy,
  normalizeShortsStartBounds,
  shouldPollShortsJob,
  updateShortsClipTransform
} from './shortsReviewState';
import './shortsReview.css';

export type ShortsOpenEditorRequest = {
  readonly sourceProjectId: string;
  readonly jobId: string;
  readonly candidateId: string;
  readonly resultProjectId: string;
};

type ShortsReviewWorkspaceProps = {
  readonly editor: TimelineEditorController;
  readonly initialJobId?: string | null;
  readonly initialCandidateId?: string | null;
  readonly returnReloadToken?: number;
  readonly onOpenSettings?: (() => void) | undefined;
  readonly onOpenMaterializedProject: (request: ShortsOpenEditorRequest) => Promise<void>;
};

const SHORTS_POLL_INTERVAL_MS = 400;

export function ShortsReviewWorkspace({
  editor,
  initialJobId = null,
  initialCandidateId = null,
  returnReloadToken = 0,
  onOpenSettings,
  onOpenMaterializedProject
}: ShortsReviewWorkspaceProps): ReactElement {
  const project = editor.project;
  const projectId = project?.id ?? null;

  const { selectedModel: getSelectedDomainModel } = useAiDomainModel();
  const selectedModel = getSelectedDomainModel('edit-agent');
  const { providerConfig } = useLlmModel();
  const chatGptAuth = useChatGptAuth();
  const { reasoningEffort, setReasoningEffort, modelReady } = useAgentChat();
  const openAiAuthMode = resolveOpenAiAuthMode(selectedModel.id, chatGptAuth.isConnected);

  const videoAssets = useMemo(
    () => (project?.assets ?? []).filter((asset) => asset.kind === 'video'),
    [project?.assets]
  );

  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [requestedCount, setRequestedCount] = useState<number>(SHORTS_DEFAULT_COUNT);
  const [minDurationSec, setMinDurationSec] = useState<number>(SHORTS_MIN_DURATION_MS_DEFAULT / 1000);
  const [maxDurationSec, setMaxDurationSec] = useState<number>(SHORTS_MAX_DURATION_MS_DEFAULT / 1000);

  const [allJobs, setAllJobs] = useState<readonly ShortsJob[]>([]);
  const [activeReviewJobId, setActiveReviewJobId] = useState<string | null>(initialJobId);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(initialCandidateId);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<readonly string[]>([]);
  const [selectedResultProjectIds, setSelectedResultProjectIds] = useState<readonly string[]>([]);

  const [rightTab, setRightTab] = useState<'edit' | 'export'>('edit');
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [isMaterializing, setIsMaterializing] = useState(false);
  const [isStartingExport, setIsStartingExport] = useState(false);
  const [isCancellingReview, setIsCancellingReview] = useState(false);
  const [isCancellingExport, setIsCancellingExport] = useState(false);
  const [cancelAcceptedJobId, setCancelAcceptedJobId] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [exportActionNotice, setExportActionNotice] = useState<{
    readonly tone: 'neutral' | 'success' | 'warning' | 'danger';
    readonly text: string;
  } | null>(null);

  const [resultProjectsById, setResultProjectsById] = useState<Readonly<Record<string, LocalProjectSnapshot>>>({});
  const [loadingResultIds, setLoadingResultIds] = useState<ReadonlySet<string>>(() => new Set());
  const [dirtyResultIds, setDirtyResultIds] = useState<ReadonlySet<string>>(() => new Set());
  const [savingResultId, setSavingResultId] = useState<string | null>(null);
  const [resultStatusById, setResultStatusById] = useState<Readonly<Record<string, string>>>({});

  const [exportJobsById, setExportJobsById] = useState<Readonly<Record<string, LocalExportJob>>>({});
  const [unavailableExportJobIds, setUnavailableExportJobIds] = useState<ReadonlySet<string>>(() => new Set());

  const prevVideoIdsRef = useRef<readonly string[]>([]);

  // Keep source video selection synchronized with imported video assets.
  useEffect(() => {
    const currentIds = videoAssets.map((asset) => asset.id);
    const newlyAdded = currentIds.find((id) => !prevVideoIdsRef.current.includes(id));
    prevVideoIdsRef.current = currentIds;

    if (newlyAdded !== undefined) {
      setSelectedAssetId(newlyAdded);
      return;
    }
    if (selectedAssetId.length === 0 || !currentIds.includes(selectedAssetId)) {
      setSelectedAssetId(currentIds[0] ?? '');
    }
  }, [selectedAssetId, videoAssets]);

  const upsertJob = useCallback((incoming: ShortsJob) => {
    setAllJobs((current) => {
      const exists = current.some((job) => job.id === incoming.id);
      if (!exists) return [incoming, ...current];
      return current.map((job) => (job.id === incoming.id ? incoming : job));
    });
  }, []);

  // Restore saved shorts runs on project load without auto-resuming interrupted jobs.
  useEffect(() => {
    if (projectId === null) {
      setAllJobs([]);
      setActiveReviewJobId(null);
      setActiveCandidateId(null);
      return;
    }
    let cancelled = false;
    setWorkspaceError(null);
    void window.videoTool.shortsList({ projectId }).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setWorkspaceError(errorMessage(response.error));
        return;
      }
      setAllJobs(response.value);
      const grouped = groupShortsRuns(response.value);
      setActiveReviewJobId((current) => {
        if (initialJobId !== null && grouped.reviewRuns.some((run) => run.id === initialJobId)) {
          return initialJobId;
        }
        if (current !== null && grouped.reviewRuns.some((run) => run.id === current)) {
          return current;
        }
        return grouped.reviewRuns[0]?.id ?? null;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [initialJobId, projectId]);

  useEffect(() => {
    if (initialJobId !== null) setActiveReviewJobId(initialJobId);
    if (initialCandidateId !== null) setActiveCandidateId(initialCandidateId);
  }, [initialCandidateId, initialJobId]);

  const groupedRuns = useMemo(() => groupShortsRuns(allJobs), [allJobs]);
  const activeReviewJob = useMemo(
    () => groupedRuns.reviewRuns.find((run) => run.id === activeReviewJobId) ?? groupedRuns.reviewRuns[0] ?? null,
    [activeReviewJobId, groupedRuns.reviewRuns]
  );
  const activeExportRuns = useMemo(
    () => (activeReviewJob === null ? [] : groupedRuns.exportRunsByRootId[activeReviewJob.id] ?? []),
    [activeReviewJob, groupedRuns.exportRunsByRootId]
  );

  const candidates = useMemo(
    () => activeReviewJob?.selection?.candidates ?? [],
    [activeReviewJob?.selection?.candidates]
  );

  // Sync candidate focus & default checkbox selections when active review job updates.
  useEffect(() => {
    if (candidates.length === 0) {
      setActiveCandidateId(null);
      setSelectedCandidateIds([]);
      return;
    }
    setActiveCandidateId((current) => {
      if (current !== null && candidates.some((candidate) => candidate.id === current)) return current;
      return candidates[0]?.id ?? null;
    });
    setSelectedCandidateIds((current) => {
      const valid = current.filter((id) => candidates.some((candidate) => candidate.id === id));
      if (valid.length > 0) return valid;
      return candidates.map((candidate) => candidate.id);
    });
  }, [activeReviewJob?.id, candidates]);

  const exportSummary = useMemo(
    () =>
      aggregateShortsExports({
        reviewJob: activeReviewJob,
        exportRuns: activeExportRuns,
        exportJobsById,
        unavailableExportJobIds
      }),
    [activeExportRuns, activeReviewJob, exportJobsById, unavailableExportJobIds]
  );

  // Sync batch export selection checkboxes when new materialized result projects appear.
  useEffect(() => {
    const readyIds = exportSummary.readyResultProjectIds;
    if (readyIds.length === 0) {
      setSelectedResultProjectIds([]);
      return;
    }
    setSelectedResultProjectIds((current) => {
      const retained = current.filter((id) => readyIds.includes(id));
      return retained.length > 0 ? retained : readyIds;
    });
  }, [exportSummary.readyResultProjectIds]);

  const activeCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === activeCandidateId) ?? candidates[0] ?? null,
    [activeCandidateId, candidates]
  );

  const activeItem = useMemo(
    () =>
      activeCandidate === null
        ? null
        : activeReviewJob?.items.find((item) => item.candidateId === activeCandidate.id) ?? null,
    [activeCandidate, activeReviewJob?.items]
  );

  const activeResultProjectId = activeItem?.resultProjectId;
  const activeResultProject = activeResultProjectId === undefined ? null : resultProjectsById[activeResultProjectId] ?? null;
  const activeRecipe = useMemo(
    () => findRecipeForCandidate(activeReviewJob, activeCandidate?.id ?? null),
    [activeCandidate?.id, activeReviewJob]
  );

  const sourceAsset = useMemo(() => {
    const targetId = activeReviewJob?.sourceAssetId ?? selectedAssetId;
    return videoAssets.find((asset) => asset.id === targetId) ?? null;
  }, [activeReviewJob?.sourceAssetId, selectedAssetId, videoAssets]);

  // Poll active review/materialize job until settled & cleanupComplete.
  useEffect(() => {
    if (!shouldPollShortsJob(activeReviewJob) || activeReviewJob === null) return;
    const jobId = activeReviewJob.id;
    const prevStage = activeReviewJob.stage;
    const timer = window.setTimeout(() => {
      void window.videoTool.shortsGet({ jobId }).then((response) => {
        if (!response.ok) return;
        upsertJob(response.value);
        if (response.value.cleanupComplete && cancelAcceptedJobId === jobId) {
          setCancelAcceptedJobId(null);
        }
        if (prevStage === 'creating' && response.value.stage !== 'creating') {
          void editor.refreshProjects();
        }
      });
    }, SHORTS_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [activeReviewJob, cancelAcceptedJobId, editor, upsertJob]);

  // Poll latest export run until settled & cleanupComplete.
  const latestExportRun = exportSummary.latestExportRun;
  useEffect(() => {
    if (!shouldPollShortsJob(latestExportRun) || latestExportRun === null) return;
    const jobId = latestExportRun.id;
    const timer = window.setTimeout(() => {
      void window.videoTool.shortsGet({ jobId }).then((response) => {
        if (!response.ok) return;
        upsertJob(response.value);
        if (response.value.cleanupComplete && cancelAcceptedJobId === jobId) {
          setCancelAcceptedJobId(null);
        }
      });
    }, SHORTS_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [cancelAcceptedJobId, latestExportRun, upsertJob]);

  // Poll individual ExportJobStore entries via existing getExportJob; handle JOB_NOT_FOUND gracefully.
  const pollableExportJobIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of exportSummary.items) {
      const candidateJobIds = [item.activeExportJobId, item.completedExportJobId].filter(
        (id): id is string => id !== undefined
      );
      for (const jobId of candidateJobIds) {
        if (unavailableExportJobIds.has(jobId)) continue;
        const known = exportJobsById[jobId];
        if (known === undefined || known.state.kind === 'queued' || known.state.kind === 'running') {
          ids.add(jobId);
        }
      }
    }
    return [...ids];
  }, [exportJobsById, exportSummary.items, unavailableExportJobIds]);

  useEffect(() => {
    if (pollableExportJobIds.length === 0) return;
    const timer = window.setTimeout(() => {
      void Promise.all(
        pollableExportJobIds.map(async (jobId) => {
          const response = await window.videoTool.getExportJob({ jobId });
          if (response.ok) {
            setExportJobsById((current) => ({ ...current, [jobId]: response.value }));
            return;
          }
          if (response.error.code === 'JOB_NOT_FOUND') {
            setUnavailableExportJobIds((current) => {
              const next = new Set(current);
              next.add(jobId);
              return next;
            });
          }
        })
      );
    }, SHORTS_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [pollableExportJobIds]);

  const loadResultProject = useCallback(async (resultProjectId: string, force = false): Promise<void> => {
    if (!force && resultProjectsById[resultProjectId] !== undefined) return;
    setLoadingResultIds((current) => new Set(current).add(resultProjectId));
    try {
      const response = await window.videoTool.openProject({ projectId: resultProjectId });
      if (response.ok) {
        setResultProjectsById((current) => ({ ...current, [resultProjectId]: response.value }));
        setDirtyResultIds((current) => {
          if (!current.has(resultProjectId)) return current;
          const next = new Set(current);
          next.delete(resultProjectId);
          return next;
        });
      } else {
        setResultStatusById((current) => ({ ...current, [resultProjectId]: errorMessage(response.error) }));
      }
    } finally {
      setLoadingResultIds((current) => {
        const next = new Set(current);
        next.delete(resultProjectId);
        return next;
      });
    }
  }, [resultProjectsById]);

  useEffect(() => {
    if (activeResultProjectId === undefined) return;
    void loadResultProject(activeResultProjectId, returnReloadToken > 0);
  }, [activeResultProjectId, loadResultProject, returnReloadToken]);

  const updateInlineTimeline = useCallback(
    (resultProjectId: string, timeline: TimelineDocument): void => {
      setResultProjectsById((current) => {
        const existing = current[resultProjectId];
        if (existing === undefined) return current;
        return { ...current, [resultProjectId]: { ...existing, timeline } };
      });
      setDirtyResultIds((current) => new Set(current).add(resultProjectId));
      setResultStatusById((current) => {
        if (current[resultProjectId] === undefined) return current;
        const next = { ...current };
        delete next[resultProjectId];
        return next;
      });
    },
    []
  );

  const saveResultProject = useCallback(
    async (resultProjectId: string): Promise<boolean> => {
      const snapshot = resultProjectsById[resultProjectId];
      if (snapshot === undefined) return true;
      setSavingResultId(resultProjectId);
      try {
        const response = await window.videoTool.saveTimeline({
          projectId: resultProjectId,
          timeline: snapshot.timeline
        });
        if (!response.ok) {
          setResultStatusById((current) => ({ ...current, [resultProjectId]: errorMessage(response.error) }));
          return false;
        }
        setResultProjectsById((current) => ({ ...current, [resultProjectId]: response.value }));
        setDirtyResultIds((current) => {
          const next = new Set(current);
          next.delete(resultProjectId);
          return next;
        });
        setResultStatusById((current) => ({ ...current, [resultProjectId]: '변경사항이 격리 쇼츠 프로젝트에 저장되었습니다.' }));
        return true;
      } finally {
        setSavingResultId((current) => (current === resultProjectId ? null : current));
      }
    },
    [resultProjectsById]
  );

  const handleStartShorts = async (): Promise<void> => {
    if (projectId === null || selectedAssetId.length === 0) return;
    const bounds = normalizeShortsStartBounds({
      requestedCount,
      minDurationSeconds: minDurationSec,
      maxDurationSeconds: maxDurationSec
    });
    if (bounds === null) {
      setWorkspaceError('후보 수(1~5)와 최소/최대 길이(초)를 올바르게 입력하세요.');
      return;
    }

    setIsStartingRun(true);
    setWorkspaceError(null);
    setExportActionNotice(null);
    try {
      const response = await window.videoTool.shortsStart({
        projectId,
        assetId: selectedAssetId,
        modelId: selectedModel.id,
        openAiAuthMode,
        ...(providerConfig.ollamaBaseUrl ? { ollamaBaseUrl: providerConfig.ollamaBaseUrl } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        requestedCount: bounds.requestedCount,
        minDurationMs: bounds.minDurationMs,
        maxDurationMs: bounds.maxDurationMs
      });
      if (!response.ok) {
        setWorkspaceError(errorMessage(response.error));
        return;
      }
      upsertJob(response.value);
      setActiveReviewJobId(response.value.id);
    } finally {
      setIsStartingRun(false);
    }
  };

  const handleCancelJob = async (jobId: string, kind: 'review' | 'export'): Promise<void> => {
    if (kind === 'review') setIsCancellingReview(true);
    else setIsCancellingExport(true);
    setWorkspaceError(null);
    try {
      const response = await window.videoTool.shortsCancel({ jobId });
      if (!response.ok) {
        setWorkspaceError(errorMessage(response.error));
        return;
      }
      if (response.value.accepted) {
        setCancelAcceptedJobId(jobId);
      }
      const refreshed = await window.videoTool.shortsGet({ jobId });
      if (refreshed.ok) upsertJob(refreshed.value);
    } finally {
      if (kind === 'review') setIsCancellingReview(false);
      else setIsCancellingExport(false);
    }
  };

  const handleMaterializeSelected = async (): Promise<void> => {
    if (activeReviewJob === null || selectedCandidateIds.length === 0) return;
    setIsMaterializing(true);
    setWorkspaceError(null);
    try {
      const response = await window.videoTool.shortsMaterialize({
        jobId: activeReviewJob.id,
        candidateIds: selectedCandidateIds
      });
      if (!response.ok) {
        setWorkspaceError(errorMessage(response.error));
        return;
      }
      upsertJob(response.value);
    } finally {
      setIsMaterializing(false);
    }
  };

  const startBatchExportForIds = async (targetResultProjectIds: readonly string[]): Promise<void> => {
    if (activeReviewJob === null || targetResultProjectIds.length === 0) return;
    setIsStartingExport(true);
    setExportActionNotice(null);
    try {
      for (const resultId of targetResultProjectIds) {
        if (dirtyResultIds.has(resultId)) {
          const saved = await saveResultProject(resultId);
          if (!saved) {
            setExportActionNotice({
              tone: 'danger',
              text: '미저장 쇼츠 타임라인을 저장하지 못해 내보내기를 시작하지 않았습니다.'
            });
            return;
          }
        }
      }
      const response = await window.videoTool.shortsExport({
        jobId: activeReviewJob.id,
        resultProjectIds: targetResultProjectIds
      });
      if (!response.ok) {
        setExportActionNotice({ tone: 'danger', text: errorMessage(response.error) });
        return;
      }
      upsertJob(response.value);
      setRightTab('export');
    } finally {
      setIsStartingExport(false);
    }
  };

  const handleOpenInTimelineEditor = async (): Promise<void> => {
    if (activeReviewJob === null || activeCandidate === null || activeResultProjectId === undefined) return;
    if (dirtyResultIds.has(activeResultProjectId)) {
      const saved = await saveResultProject(activeResultProjectId);
      if (!saved) return;
    }
    await onOpenMaterializedProject({
      sourceProjectId: activeReviewJob.sourceProjectId,
      jobId: activeReviewJob.id,
      candidateId: activeCandidate.id,
      resultProjectId: activeResultProjectId
    });
  };

  const handleOpenExportResult = async (jobId: string): Promise<void> => {
    const response = await window.videoTool.openExportResult({ jobId });
    setExportActionNotice(
      response.ok
        ? { tone: 'success', text: '내보낸 MP4를 기본 로컬 플레이어로 열었습니다.' }
        : { tone: 'danger', text: errorMessage(response.error) }
    );
  };

  const handleRevealExportResult = async (jobId: string): Promise<void> => {
    const response = await window.videoTool.revealExportResult({ jobId });
    setExportActionNotice(
      response.ok
        ? { tone: 'success', text: '내보낸 MP4 위치를 로컬 파일 관리자에서 열었습니다.' }
        : { tone: 'danger', text: errorMessage(response.error) }
    );
  };

  const handleCandidateCardKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number, candidateId: string): void => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = candidates[Math.min(candidates.length - 1, index + 1)];
      if (next !== undefined) setActiveCandidateId(next.id);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = candidates[Math.max(0, index - 1)];
      if (prev !== undefined) setActiveCandidateId(prev.id);
    } else if (event.key === ' ') {
      event.preventDefault();
      if (activeReviewJob?.stage === 'review') {
        setSelectedCandidateIds((current) =>
          current.includes(candidateId) ? current.filter((id) => id !== candidateId) : [...current, candidateId]
        );
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      setActiveCandidateId(candidateId);
    } else if (event.key === 'Escape') {
      setWorkspaceError(null);
    }
  };

  const errorGuidance = getShortsErrorGuidance(activeReviewJob);
  const selectionNotice = getShortsSelectionNotice(activeReviewJob);
  const reviewBusy = isShortsJobBusy(activeReviewJob);
  const selectedSourceAsset = videoAssets.find((asset) => asset.id === selectedAssetId) ?? null;
  const selectedSourceProbeError =
    selectedSourceAsset === null ? undefined : editor.metadataProbeFailuresByAssetId[selectedSourceAsset.id];
  const allCandidatesSelected =
    candidates.length > 0 && candidates.every((candidate) => selectedCandidateIds.includes(candidate.id));

  const handlePreviewTransformUpdate = useCallback(
    (partial: Partial<Pick<ClipEffects, 'positionX' | 'positionY' | 'scale'>>): void => {
      if (activeResultProjectId === undefined || activeResultProject === null) return;
      const clip = getPrimaryShortsClip(activeResultProject.timeline);
      if (clip === null) return;
      const next = updateShortsClipTransform(activeResultProject.timeline, clip.id, partial);
      if (next !== null) updateInlineTimeline(activeResultProjectId, next);
    },
    [activeResultProject, activeResultProjectId, updateInlineTimeline]
  );

  return (
    <div
      className="shorts-workspace"
      data-testid="shorts-review-workspace"
      role="region"
      aria-label="Shorts review workspace"
      onKeyDown={(event) => {
        if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
        // Keep timeline global shortcuts (Space/Arrow/Delete/etc.) from firing while operating Shorts Review UI.
        if (
          event.key === ' ' ||
          event.key === 'Delete' ||
          event.key === 'Backspace' ||
          event.key.startsWith('Arrow')
        ) {
          event.preventDefault();
        }
      }}
    >
      <div>
        <div className="shorts-source-bar" role="toolbar" aria-label="쇼츠 소스 및 생성 제어">
          <div className="shorts-source-bar__group">
            <Button
              variant="primary"
              data-testid="shorts-import-video-btn"
              disabled={project === null || editor.isBusy}
              onClick={() => { void editor.importAssets(['video']); }}
            >
              PC 영상 가져오기
            </Button>
            <label className="shorts-source-bar__label" htmlFor="shorts-source-select">원본 영상</label>
            <select
              id="shorts-source-select"
              data-testid="shorts-source-select"
              aria-label="Select imported source video"
              value={selectedAssetId}
              disabled={videoAssets.length === 0 || reviewBusy}
              onChange={(event) => setSelectedAssetId(event.currentTarget.value)}
            >
              {videoAssets.length === 0 ? (
                <option value="">임포트된 영상 없음</option>
              ) : (
                videoAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.displayName} ({asset.metadata === null ? '메타데이터 읽는 중' : formatDuration(asset.metadata.durationMs)})
                  </option>
                ))
              )}
            </select>
            {selectedSourceProbeError !== undefined && selectedSourceAsset !== null && (
              <Button onClick={() => editor.retryAssetMetadataProbe(selectedSourceAsset.id)}>프로브 재시도</Button>
            )}
          </div>

          <div className="shorts-source-bar__group">
            <AgentModelPicker reasoningEffort={reasoningEffort} onReasoningEffortChange={setReasoningEffort} />
            {!modelReady && onOpenSettings !== undefined && (
              <Button data-testid="shorts-model-settings-btn" onClick={onOpenSettings}>모델 설정</Button>
            )}
          </div>

          <div className="shorts-source-bar__group">
            <label className="shorts-source-bar__label" htmlFor="shorts-requested-count">후보 수</label>
            <input
              id="shorts-requested-count"
              type="number"
              data-testid="shorts-requested-count-input"
              aria-label="Requested shorts candidate count"
              min={SHORTS_COUNT_MIN}
              max={SHORTS_COUNT_MAX}
              value={requestedCount}
              disabled={reviewBusy}
              onChange={(event) => setRequestedCount(Number(event.currentTarget.value))}
            />
            <label className="shorts-source-bar__label" htmlFor="shorts-min-duration">최소(s)</label>
            <input
              id="shorts-min-duration"
              type="number"
              data-testid="shorts-min-duration-input"
              aria-label="Minimum short duration seconds"
              min={1}
              value={minDurationSec}
              disabled={reviewBusy}
              onChange={(event) => setMinDurationSec(Number(event.currentTarget.value))}
            />
            <label className="shorts-source-bar__label" htmlFor="shorts-max-duration">최대(s)</label>
            <input
              id="shorts-max-duration"
              type="number"
              data-testid="shorts-max-duration-input"
              aria-label="Maximum short duration seconds"
              min={1}
              value={maxDurationSec}
              disabled={reviewBusy}
              onChange={(event) => setMaxDurationSec(Number(event.currentTarget.value))}
            />
          </div>

          <div className="shorts-source-bar__group">
            <Button
              variant="primary"
              data-testid="shorts-start-btn"
              disabled={project === null || selectedAssetId.length === 0 || isStartingRun || reviewBusy}
              onClick={() => { void handleStartShorts(); }}
            >
              {isStartingRun ? '시작 중…' : '쇼츠 후보 찾기'}
            </Button>
            {activeReviewJob !== null && (reviewBusy || !activeReviewJob.cleanupComplete) && activeReviewJob.errorCode !== 'interrupted' && (
              <Button
                variant="stop"
                data-testid="shorts-cancel-btn"
                disabled={isCancellingReview || activeReviewJob.stage === 'cancelling'}
                onClick={() => { void handleCancelJob(activeReviewJob.id, 'review'); }}
              >
                {activeReviewJob.stage === 'cancelling' ? '취소 정리 중…' : '취소'}
              </Button>
            )}
          </div>

          <span className="shorts-source-bar__spacer" />

          {groupedRuns.reviewRuns.length > 0 && (
            <div className="shorts-source-bar__group">
              <label className="shorts-source-bar__label" htmlFor="shorts-run-history">저장된 실행</label>
              <select
                id="shorts-run-history"
                data-testid="shorts-run-history-select"
                aria-label="Select saved shorts run"
                value={activeReviewJob?.id ?? ''}
                onChange={(event) => setActiveReviewJobId(event.currentTarget.value || null)}
              >
                {groupedRuns.reviewRuns.map((run, index) => (
                  <option key={run.id} value={run.id}>
                    #{groupedRuns.reviewRuns.length - index} · {formatShortsStageLabel(run.stage, run.cleanupComplete)} ({run.selection?.candidates.length ?? 0}후보)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {(activeReviewJob !== null || workspaceError !== null) && (
          <div className="shorts-status-strip">
            {activeReviewJob !== null && (
              <div className="shorts-status-strip__row" data-testid="shorts-stage-status" role="status">
                <span>
                  상태: <strong>{formatShortsStageLabel(activeReviewJob.stage, activeReviewJob.cleanupComplete)}</strong>
                  {activeReviewJob.stage === 'transcribing' && activeReviewJob.transcription !== undefined
                    ? ` (${activeReviewJob.transcription.progressPercent}%)`
                    : ''}
                  {cancelAcceptedJobId === activeReviewJob.id && !activeReviewJob.cleanupComplete
                    ? ' · 취소 수락됨, 정리 완료 확인 중'
                    : ''}
                </span>
                <span className="shorts-badge" data-testid="shorts-cleanup-status">
                  {activeReviewJob.cleanupComplete ? 'cleanupComplete: 완료' : 'cleanupComplete: 대기'}
                </span>
              </div>
            )}

            {activeReviewJob?.stage === 'transcribing' && activeReviewJob.transcription !== undefined && (
              <progress
                data-testid="shorts-transcription-progress"
                aria-label="Local transcription progress"
                aria-valuetext={`${activeReviewJob.transcription.progressPercent}%`}
                max={100}
                value={activeReviewJob.transcription.progressPercent}
                style={{ width: '100%' }}
              />
            )}

            {workspaceError !== null && (
              <StatusCard tone="danger" data-testid="shorts-workspace-error">
                {workspaceError}
              </StatusCard>
            )}

            {errorGuidance !== null && (
              <StatusCard tone={errorGuidance.tone} data-testid="shorts-error-banner">
                <div className="shorts-row">
                  <div>
                    <strong>{errorGuidance.title}</strong>
                    <p className="shorts-muted">{errorGuidance.detail}</p>
                  </div>
                  {errorGuidance.openSettings && onOpenSettings !== undefined && (
                    <Button data-testid="shorts-open-settings-btn" onClick={onOpenSettings}>
                      Settings 열기
                    </Button>
                  )}
                </div>
              </StatusCard>
            )}

            {selectionNotice !== null && (
              <StatusCard tone="warning" data-testid="shorts-insufficient-evidence-banner">
                <strong>{selectionNotice.title}</strong>
                <p className="shorts-muted">{selectionNotice.detail}</p>
                {selectionNotice.warnings.length > 0 && (
                  <p className="shorts-muted">안내: {selectionNotice.warnings.join(' · ')}</p>
                )}
              </StatusCard>
            )}
          </div>
        )}
      </div>

      <div className="shorts-body">
        <aside className="shorts-pane shorts-pane--candidates" aria-label="쇼츠 후보 카드 목록">
          <div className="shorts-pane__header">
            <h2>쇼츠 후보 ({candidates.length})</h2>
            {candidates.length > 0 && activeReviewJob?.stage === 'review' && (
              <label className="shorts-source-bar__group">
                <input
                  type="checkbox"
                  data-testid="shorts-candidate-select-all"
                  aria-label="Select all shorts candidates"
                  checked={allCandidatesSelected}
                  onChange={(event) =>
                    setSelectedCandidateIds(event.currentTarget.checked ? candidates.map((c) => c.id) : [])
                  }
                />
                <span>전체</span>
              </label>
            )}
          </div>

          <div
            className="shorts-pane__scroll"
            data-testid="shorts-candidate-list"
            role="listbox"
            aria-label="Shorts candidates"
          >
            {candidates.length === 0 ? (
              <p className="shorts-muted">
                PC 로컬 긴 영상을 가져온 뒤 <strong>쇼츠 후보 찾기</strong>를 실행하면 원본 구간·선정 이유·자막 프리뷰 카드가 여기에 표시됩니다.
              </p>
            ) : (
              candidates.map((candidate, index) => {
                const isActive = candidate.id === activeCandidate?.id;
                const isChecked = selectedCandidateIds.includes(candidate.id);
                const item = activeReviewJob?.items.find((entry) => entry.candidateId === candidate.id);
                const captionCount = filterSourceCaptionsForCandidate(activeReviewJob?.captions, candidate).length;
                const durationMs = Math.max(0, candidate.endMs - candidate.startMs);

                return (
                  <div
                    key={candidate.id}
                    role="option"
                    tabIndex={0}
                    aria-selected={isActive}
                    aria-current={isActive ? 'true' : undefined}
                    data-active={isActive ? 'true' : 'false'}
                    data-testid={`shorts-candidate-card-${candidate.id}`}
                    className="shorts-candidate-card"
                    onClick={() => setActiveCandidateId(candidate.id)}
                    onKeyDown={(event) => handleCandidateCardKeyDown(event, index, candidate.id)}
                  >
                    <div className="shorts-candidate-card__top">
                      <input
                        type="checkbox"
                        data-testid={`shorts-candidate-checkbox-${candidate.id}`}
                        aria-label={`Select candidate ${candidate.id}`}
                        aria-checked={isChecked}
                        checked={isChecked}
                        disabled={activeReviewJob?.stage !== 'review'}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setSelectedCandidateIds((current) =>
                            checked
                              ? current.includes(candidate.id)
                                ? current
                                : [...current, candidate.id]
                              : current.filter((id) => id !== candidate.id)
                          );
                        }}
                      />
                      <span
                        className="shorts-candidate-card__range"
                        data-testid={`shorts-candidate-range-${candidate.id}`}
                      >
                        {formatDuration(candidate.startMs)} – {formatDuration(candidate.endMs)}
                      </span>
                      <span
                        className="shorts-candidate-card__duration"
                        data-testid={`shorts-candidate-duration-${candidate.id}`}
                      >
                        {formatDuration(durationMs)}
                      </span>
                    </div>

                    <p
                      className="shorts-candidate-card__reason"
                      data-testid={`shorts-candidate-reason-${candidate.id}`}
                    >
                      {candidate.reason}
                    </p>

                    <div className="shorts-candidate-card__meta">
                      <span
                        className="shorts-badge shorts-badge--fit"
                        data-testid={`shorts-candidate-fit-badge-${candidate.id}`}
                      >
                        {SHORTS_FIT_LABEL}
                      </span>
                      <span className="shorts-badge">자막 {captionCount}건</span>
                      {item !== undefined && (
                        <span
                          className={`shorts-badge ${
                            item.status === 'ready' || item.status === 'completed'
                              ? 'shorts-badge--ready'
                              : item.status === 'failed'
                                ? 'shorts-badge--failed'
                                : 'shorts-badge--busy'
                          }`}
                          data-testid={`shorts-candidate-status-${candidate.id}`}
                        >
                          {item.status}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="shorts-pane__footer">
            <Button
              variant="primary"
              data-testid="shorts-materialize-btn"
              disabled={
                activeReviewJob === null ||
                activeReviewJob.stage !== 'review' ||
                selectedCandidateIds.length === 0 ||
                selectedCandidateIds.length > SHORTS_COUNT_MAX ||
                isMaterializing
              }
              onClick={() => { void handleMaterializeSelected(); }}
            >
              {isMaterializing
                ? '쇼츠 프로젝트 생성 중…'
                : `선택 후보 쇼츠 프로젝트 생성 (${selectedCandidateIds.length}개)`}
            </Button>
            <p className="shorts-muted">
              승인 시 원본 프로젝트는 수정하지 않고 선택 후보별 격리 프로젝트를 생성합니다.
            </p>
          </div>
        </aside>

        <section className="shorts-pane shorts-pane--preview" aria-label="9:16 프리뷰 스테이지">
          <ShortsCandidatePreview
            sourceProjectId={projectId ?? ''}
            sourceAsset={sourceAsset}
            candidate={activeCandidate}
            sourceCaptions={activeReviewJob?.captions}
            recipe={activeRecipe}
            resultProject={activeResultProject}
            onUpdateTransform={activeResultProject === null ? undefined : handlePreviewTransformUpdate}
          />
        </section>

        <aside className="shorts-pane shorts-pane--inspector" aria-label="쇼츠 편집 및 일괄 내보내기">
          <div className="shorts-inspector-tabs" role="tablist" aria-label="쇼츠 우측 패널">
            <button
              type="button"
              role="tab"
              aria-selected={rightTab === 'edit'}
              data-testid="shorts-tab-edit"
              onClick={() => setRightTab('edit')}
            >
              검토 · 수정
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={rightTab === 'export'}
              data-testid="shorts-tab-export"
              onClick={() => setRightTab('export')}
            >
              일괄 Export ({exportSummary.totalCount})
            </button>
          </div>

          <div className="shorts-pane__scroll">
            {rightTab === 'edit' ? (
              <ShortsResultEditor
                candidate={activeCandidate}
                sourceCaptions={activeReviewJob?.captions}
                resultProjectId={activeResultProjectId}
                resultProject={activeResultProject}
                isLoadingResult={activeResultProjectId !== undefined && loadingResultIds.has(activeResultProjectId)}
                isSavingResult={activeResultProjectId !== undefined && savingResultId === activeResultProjectId}
                isDirty={activeResultProjectId !== undefined && dirtyResultIds.has(activeResultProjectId)}
                statusMessage={activeResultProjectId === undefined ? null : resultStatusById[activeResultProjectId] ?? null}
                onChangeTimeline={(timeline) => {
                  if (activeResultProjectId !== undefined) updateInlineTimeline(activeResultProjectId, timeline);
                }}
                onSaveTimeline={() => {
                  if (activeResultProjectId !== undefined) void saveResultProject(activeResultProjectId);
                }}
                onOpenInTimelineEditor={() => { void handleOpenInTimelineEditor(); }}
              />
            ) : (
              <ShortsBatchExportPanel
                summary={exportSummary}
                selectedResultProjectIds={selectedResultProjectIds}
                isStartingExport={isStartingExport}
                isCancellingExport={isCancellingExport}
                exportActionNotice={exportActionNotice}
                activeExportRuns={activeExportRuns}
                onToggleSelectAll={(checked) =>
                  setSelectedResultProjectIds(checked ? exportSummary.readyResultProjectIds : [])
                }
                onToggleItem={(resultProjectId, checked) =>
                  setSelectedResultProjectIds((current) =>
                    checked
                      ? current.includes(resultProjectId)
                        ? current
                        : [...current, resultProjectId]
                      : current.filter((id) => id !== resultProjectId)
                  )
                }
                onStartBatchExport={() => { void startBatchExportForIds(selectedResultProjectIds); }}
                onRetryFailed={() => { void startBatchExportForIds(exportSummary.failedResultProjectIds); }}
                onCancelExport={() => {
                  if (latestExportRun !== null) void handleCancelJob(latestExportRun.id, 'export');
                }}
                onOpenExportResult={(jobId) => { void handleOpenExportResult(jobId); }}
                onRevealExportResult={(jobId) => { void handleRevealExportResult(jobId); }}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
