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
  canApplyResultAsyncResponse,
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
  readonly active?: boolean;
  readonly editor: TimelineEditorController;
  readonly initialJobId?: string | null;
  readonly initialCandidateId?: string | null;
  readonly returnReloadToken?: number;
  readonly returnReloadProjectId?: string | null;
  readonly onOpenSettings?: (() => void) | undefined;
  readonly onOpenMaterializedProject: (request: ShortsOpenEditorRequest) => Promise<void>;
};

const SHORTS_POLL_INTERVAL_MS = 400;

export function ShortsReviewWorkspace(props: ShortsReviewWorkspaceProps): ReactElement {
  const [retained, setRetained] = useState<ReadonlyMap<string, ShortsReviewWorkspaceProps>>(() => new Map());
  const draftState = useRef(new Map<string, { dirty: boolean; busy: boolean }>());
  const projectId = props.editor.project?.id ?? null;
  const knownIds = new Set(props.editor.projects.map((project) => project.id));
  const next = new Map([...retained].filter(([id]) => knownIds.has(id)));
  if (projectId !== null) { next.delete(projectId); next.set(projectId, props); }
  // Keep at most four idle clean controllers in addition to the active one.
  // Unsaved/in-flight work is never evicted; it is bounded by the actual local
  // project inventory and is disposed only after save/idle or explicit deletion.
  const idle = [...next.keys()].filter((id) => id !== projectId && !draftState.current.get(id)?.dirty && !draftState.current.get(id)?.busy);
  for (const id of idle.slice(0, Math.max(0, idle.length - 4))) next.delete(id);
  useEffect(() => {
    setRetained(next);
    for (const id of draftState.current.keys()) if (!next.has(id)) draftState.current.delete(id);
  }, [props]);
  return <>
    {[...next].map(([id, sourceProps]) => <ProjectShortsReviewWorkspace key={id} {...sourceProps}
      active={id === projectId && props.active !== false} onDraftStateChange={(state) => { draftState.current.set(id, state); }} />)}
    {projectId === null && <ProjectShortsReviewWorkspace {...props} active={props.active !== false} onDraftStateChange={() => {}} />}
  </>;
}

function ProjectShortsReviewWorkspace({
  editor,
  initialJobId = null,
  initialCandidateId = null,
  returnReloadToken = 0,
  returnReloadProjectId = null,
  onOpenSettings,
  onOpenMaterializedProject,
  active,
  onDraftStateChange
}: ShortsReviewWorkspaceProps & { readonly active: boolean; readonly onDraftStateChange: (state: { dirty: boolean; busy: boolean }) => void }): ReactElement | null {
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

  const mountedRef = useRef(true);
  const activeRef = useRef(active);
  const activeEpochRef = useRef(0);
  if (activeRef.current !== active) activeEpochRef.current += 1;
  activeRef.current = active;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [resultProjectsById, setResultProjectsById] = useState<Readonly<Record<string, LocalProjectSnapshot>>>({});
  const resultProjectsRef = useRef<Readonly<Record<string, LocalProjectSnapshot>>>({});
  const resultRevisionByIdRef = useRef<Record<string, number>>({});
  const latestLoadRevByIdRef = useRef<Record<string, number>>({});
  const lastReloadTokenRef = useRef<number>(returnReloadToken);
  const [loadingResultIds, setLoadingResultIds] = useState<ReadonlySet<string>>(() => new Set());
  const [dirtyResultIds, setDirtyResultIds] = useState<ReadonlySet<string>>(() => new Set());
  const [savingResultId, setSavingResultId] = useState<string | null>(null);
  const [resultStatusById, setResultStatusById] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => { onDraftStateChange({ dirty: dirtyResultIds.size > 0,
    busy: isStartingRun || isMaterializing || isStartingExport || isCancellingReview || isCancellingExport || savingResultId !== null || loadingResultIds.size > 0 });
  }, [dirtyResultIds, isStartingRun, isMaterializing, isStartingExport, isCancellingReview, isCancellingExport, savingResultId, loadingResultIds, onDraftStateChange]);

  const bumpResultRevision = useCallback((resultProjectId: string): number => {
    const next = (resultRevisionByIdRef.current[resultProjectId] ?? 0) + 1;
    resultRevisionByIdRef.current[resultProjectId] = next;
    return next;
  }, []);

  useEffect(() => {
    resultProjectsRef.current = resultProjectsById;
  }, [resultProjectsById]);

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
    if (!active) return;
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
  }, [active, initialJobId, projectId]);

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
    if (!active || !shouldPollShortsJob(activeReviewJob) || activeReviewJob === null) return;
    const jobId = activeReviewJob.id;
    const prevStage = activeReviewJob.stage;
    const timer = window.setTimeout(() => {
      if (!mountedRef.current || !activeRef.current) return;
      void window.videoTool.shortsGet({ jobId }).then((response) => {
        if (!mountedRef.current || !response.ok) return;
        upsertJob(response.value);
        if (response.value.cleanupComplete && cancelAcceptedJobId === jobId) {
          setCancelAcceptedJobId(null);
        }
        if (activeRef.current && prevStage === 'creating' && response.value.stage !== 'creating') {
          void editor.refreshProjects();
        }
      });
    }, SHORTS_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [active, activeReviewJob, cancelAcceptedJobId, editor, upsertJob]);

  // Poll latest export run until settled & cleanupComplete.
  const latestExportRun = exportSummary.latestExportRun;
  useEffect(() => {
    if (!active || !shouldPollShortsJob(latestExportRun) || latestExportRun === null) return;
    const jobId = latestExportRun.id;
    const timer = window.setTimeout(() => {
      if (!mountedRef.current || !activeRef.current) return;
      void window.videoTool.shortsGet({ jobId }).then((response) => {
        if (!mountedRef.current || !response.ok) return;
        upsertJob(response.value);
        if (response.value.cleanupComplete && cancelAcceptedJobId === jobId) {
          setCancelAcceptedJobId(null);
        }
      });
    }, SHORTS_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [active, cancelAcceptedJobId, latestExportRun, upsertJob]);

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
    if (!active || pollableExportJobIds.length === 0) return;
    const timer = window.setTimeout(() => {
      if (!mountedRef.current || !activeRef.current) return;
      void Promise.all(
        pollableExportJobIds.map(async (jobId) => {
          const response = await window.videoTool.getExportJob({ jobId });
          if (!mountedRef.current) return;
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
  }, [active, pollableExportJobIds]);

  const loadResultProject = useCallback(async (resultProjectId: string, force = false): Promise<void> => {
    if (!force && resultProjectsRef.current[resultProjectId] !== undefined) return;
    const startRev = bumpResultRevision(resultProjectId);
    latestLoadRevByIdRef.current[resultProjectId] = startRev;
    setLoadingResultIds((current) => new Set(current).add(resultProjectId));
    try {
      const response = await window.videoTool.openProject({ projectId: resultProjectId });
      if (
        !canApplyResultAsyncResponse({
          mounted: mountedRef.current,
          currentRevision: resultRevisionByIdRef.current[resultProjectId] ?? 0,
          requestRevision: startRev
        })
      ) {
        return;
      }
      if (response.ok) {
        setResultProjectsById((current) => {
          const next = { ...current, [resultProjectId]: response.value };
          resultProjectsRef.current = next;
          return next;
        });
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
      if (mountedRef.current && latestLoadRevByIdRef.current[resultProjectId] === startRev) {
        setLoadingResultIds((current) => {
          if (!current.has(resultProjectId)) return current;
          const next = new Set(current);
          next.delete(resultProjectId);
          return next;
        });
      }
    }
  }, [bumpResultRevision]);

  useEffect(() => {
    if (!active || activeResultProjectId === undefined) return;
    const force = returnReloadProjectId === activeResultProjectId && returnReloadToken > lastReloadTokenRef.current;
    if (force) lastReloadTokenRef.current = returnReloadToken;
    void loadResultProject(activeResultProjectId, force);
  }, [active, activeResultProjectId, loadResultProject, returnReloadToken, returnReloadProjectId]);

  const updateInlineTimeline = useCallback(
    (resultProjectId: string, updater: (timeline: TimelineDocument) => TimelineDocument | null): void => {
      const existing = resultProjectsRef.current[resultProjectId];
      if (existing === undefined) return;
      const nextTimeline = updater(existing.timeline);
      if (nextTimeline === null) return;
      bumpResultRevision(resultProjectId);
      const updatedSnapshot: LocalProjectSnapshot = { ...existing, timeline: nextTimeline };
      const nextMap = { ...resultProjectsRef.current, [resultProjectId]: updatedSnapshot };
      resultProjectsRef.current = nextMap;
      setResultProjectsById(nextMap);
      setDirtyResultIds((current) => new Set(current).add(resultProjectId));
      setResultStatusById((current) => {
        if (current[resultProjectId] === undefined) return current;
        const next = { ...current };
        delete next[resultProjectId];
        return next;
      });
    },
    [bumpResultRevision]
  );

  const saveResultProject = useCallback(
    async (resultProjectId: string): Promise<boolean> => {
      const snapshot = resultProjectsRef.current[resultProjectId];
      if (snapshot === undefined) return true;
      const saveRev = resultRevisionByIdRef.current[resultProjectId] ?? 0;
      setSavingResultId(resultProjectId);
      try {
        const response = await window.videoTool.saveTimeline({
          projectId: resultProjectId,
          timeline: snapshot.timeline
        });
        if (!mountedRef.current) return false;
        if (!response.ok) {
          setResultStatusById((current) => ({ ...current, [resultProjectId]: errorMessage(response.error) }));
          return false;
        }
        if (
          !canApplyResultAsyncResponse({
            mounted: mountedRef.current,
            currentRevision: resultRevisionByIdRef.current[resultProjectId] ?? 0,
            requestRevision: saveRev
          })
        ) {
          // Newer local edits arrived while saveTimeline was in flight; preserve local timeline & dirty state.
          setResultStatusById((current) => ({
            ...current,
            [resultProjectId]: '저장 중 추가 편집이 발생하여 최신 변경사항을 유지했습니다. 다시 저장하세요.'
          }));
          return false;
        }
        setResultProjectsById((current) => {
          const next = { ...current, [resultProjectId]: response.value };
          resultProjectsRef.current = next;
          return next;
        });
        setDirtyResultIds((current) => {
          const next = new Set(current);
          next.delete(resultProjectId);
          return next;
        });
        setResultStatusById((current) => ({ ...current, [resultProjectId]: '변경사항이 격리 쇼츠 프로젝트에 저장되었습니다.' }));
        return true;
      } finally {
        if (mountedRef.current) {
          setSavingResultId((current) => (current === resultProjectId ? null : current));
        }
      }
    },
    []
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
      if (!mountedRef.current) return;
      if (!response.ok) {
        setWorkspaceError(errorMessage(response.error));
        return;
      }
      upsertJob(response.value);
      setActiveReviewJobId(response.value.id);
    } finally {
      if (mountedRef.current) setIsStartingRun(false);
    }
  };

  const handleCancelJob = async (jobId: string, kind: 'review' | 'export'): Promise<void> => {
    if (kind === 'review') setIsCancellingReview(true);
    else setIsCancellingExport(true);
    setWorkspaceError(null);
    try {
      const response = await window.videoTool.shortsCancel({ jobId });
      if (!mountedRef.current) return;
      if (!response.ok) {
        setWorkspaceError(errorMessage(response.error));
        return;
      }
      if (response.value.accepted) {
        setCancelAcceptedJobId(jobId);
      }
      if (!activeRef.current) return;
      const refreshed = await window.videoTool.shortsGet({ jobId });
      if (!mountedRef.current) return;
      if (refreshed.ok) upsertJob(refreshed.value);
    } finally {
      if (mountedRef.current) {
        if (kind === 'review') setIsCancellingReview(false);
        else setIsCancellingExport(false);
      }
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
      if (!mountedRef.current) return;
      if (!response.ok) {
        setWorkspaceError(errorMessage(response.error));
        return;
      }
      upsertJob(response.value);
    } finally {
      if (mountedRef.current) setIsMaterializing(false);
    }
  };

  const startBatchExportForIds = async (targetResultProjectIds: readonly string[]): Promise<void> => {
    const requestEpoch = activeEpochRef.current;
    if (activeReviewJob === null || targetResultProjectIds.length === 0) return;
    setIsStartingExport(true);
    setExportActionNotice(null);
    try {
      for (const resultId of targetResultProjectIds) {
        if (dirtyResultIds.has(resultId)) {
          const saved = await saveResultProject(resultId);
          if (!mountedRef.current) return;
          if (!saved) {
            setExportActionNotice({
              tone: 'danger',
              text: '미저장 쇼츠 타임라인을 저장하지 못해 내보내기를 시작하지 않았습니다.'
            });
            return;
          }
        }
      }
      if (!activeRef.current || activeEpochRef.current !== requestEpoch) return;
      const response = await window.videoTool.shortsExport({
        jobId: activeReviewJob.id,
        resultProjectIds: targetResultProjectIds
      });
      if (!mountedRef.current) return;
      if (!response.ok) {
        setExportActionNotice({ tone: 'danger', text: errorMessage(response.error) });
        return;
      }
      upsertJob(response.value);
      setRightTab('export');
    } finally {
      if (mountedRef.current) setIsStartingExport(false);
    }
  };

  const handleOpenInTimelineEditor = async (): Promise<void> => {
    const requestEpoch = activeEpochRef.current;
    if (activeReviewJob === null || activeCandidate === null || activeResultProjectId === undefined) return;
    if (dirtyResultIds.has(activeResultProjectId)) {
      const saved = await saveResultProject(activeResultProjectId);
      if (!mountedRef.current || !saved) return;
    }
    if (!activeRef.current || activeEpochRef.current !== requestEpoch) return;
    await onOpenMaterializedProject({
      sourceProjectId: activeReviewJob.sourceProjectId,
      jobId: activeReviewJob.id,
      candidateId: activeCandidate.id,
      resultProjectId: activeResultProjectId
    });
  };

  const handleOpenExportResult = async (jobId: string): Promise<void> => {
    const response = await window.videoTool.openExportResult({ jobId });
    if (!mountedRef.current) return;
    setExportActionNotice(
      response.ok
        ? { tone: 'success', text: '내보낸 MP4를 기본 로컬 플레이어로 열었습니다.' }
        : { tone: 'danger', text: errorMessage(response.error) }
    );
  };

  const handleRevealExportResult = async (jobId: string): Promise<void> => {
    const response = await window.videoTool.revealExportResult({ jobId });
    if (!mountedRef.current) return;
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
      if (activeResultProjectId === undefined) return;
      updateInlineTimeline(activeResultProjectId, (timeline) => {
        const clip = getPrimaryShortsClip(timeline);
        return clip === null ? null : updateShortsClipTransform(timeline, clip.id, partial);
      });
    },
    [activeResultProjectId, updateInlineTimeline]
  );

  // Inactive source controllers retain drafts but render no controls/IDs and
  // schedule no polls. Existing requests may settle only into their own cache.
  if (!active) return null;
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
                onChangeTimeline={(updater) => {
                  if (activeResultProjectId !== undefined) updateInlineTimeline(activeResultProjectId, updater);
                }}
                onSaveTimeline={() => {
                  if (activeResultProjectId !== undefined) void saveResultProject(activeResultProjectId);
                }}
                onReloadTimeline={() => {
                  if (activeResultProjectId !== undefined) void loadResultProject(activeResultProjectId, true);
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
