import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { REA_ANALYSIS_CHANNELS, type ReaAnalysisInput, type ReaAnalysisJob, type ReaAnalysisRuntime, type ReaPrepareImportInput } from '../shared/reaVideoAnalysis';
import { REA_GENERATION_CHANNELS, type ReaGenerationApi } from '../shared/reaGenerationApi';
import type { CuaActionSettlementAck, CuaActionSettlementTag, CuaCancelAck, CuaPrepareAck, CuaState, CuaStopResult, CuaSurfaceSnapshot } from '../shared/cua';
import type { CuaSaveCommitAck, CuaSaveReadyAck, CuaSaveReadyRequest, CuaSaveResult, CuaSaveSnapshotReport, CuaSaveSnapshotRequest } from '../shared/cuaSave';

import type {
  AgentChatApprovalInput,
  AgentChatCancelInput,
  AgentChatCompactInput,
  AgentChatHistoryEntry,
  AgentChatHistoryGetInput,
  AgentChatResetInput,
  AgentChatSendInput,
  AgentChatStoredConversation,
  AgentChatTurnState
} from '../shared/agentChat';
import type { SaveAiProjectDocumentInput } from '../shared/aiProjectDomain';
import type { ExportJobActionInput, LocalExportJob, LocalFfmpegRuntimeStatus, StartExportJobInput } from '../shared/exportTypes';
import { IPC_CHANNELS } from '../shared/ipc';
import { JEV_CREDENTIAL_CHANNELS, type JevCredentialApi } from '../shared/jevCredentials';
import { JEV_CONFIG_CHANNELS, type JevConfigApi } from '../shared/jevConfig';
import type {
  AbortRecordingInput,
  ApiResponse,
  AppSettings,
  AppendRecordingChunkInput,
  CaptureSource,
  ChunkAck,
  FinishRecordingInput,
  RecordingResult,
  RecordingSession,
  ResultActionInput,
  SelectSourceInput,
  SourceAvailability,
  SourceAvailabilityInput,
  StartRecordingInput
} from '../shared/models';
import type { ChatGptOAuthStatus, OpenAiAuthMode } from '../shared/openAiAuth';
import type { TimelineMenuCommandId, TimelineMenuState } from '../shared/timelineMenuCommands';
import { parseTimelineMenuCommandId } from '../shared/timelineMenuCommands';
import type { WindowMenuAction } from '../shared/windowMenuActions';
import type { TitleFontData, TitleFontRequest } from '../shared/titleTypography';
import type {
  CreateProjectInput,
  CreateProjectResult,
  DeleteProjectInput,
  DetachVideoAudioInput,
  DetachVideoAudioResult,
  GetAssetPlaybackUrlInput,
  ImportProjectAssetsInput,
  ImportRecordingResultAssetInput,
  LocalProjectSnapshot,
  LocalProjectSummary,
  MediaAsset,
  OpenProjectFolderResult,
  OpenProjectInput,
  SaveTimelineInput,
  UpdateAssetMetadataInput
} from '../shared/timelineTypes';
import type { StartTranscriptionInput, TranscriptionJob, WhisperCppRuntimeStatus } from '../shared/transcription';
import type { ShortsStartInput, ShortsJobInput, ShortsListInput, ShortsMaterializeInput, ShortsExportInput, ShortsJob } from '../shared/shortsTypes';
import type { UpdaterState } from '../shared/updater';

type ImportProjectAssetsResult = {
  readonly assets: readonly MediaAsset[];
};

type AssetPlaybackUrl = {
  readonly url: string;
};

export interface VideoToolApi extends JevCredentialApi, JevConfigApi, ReaGenerationApi {
  reaAnalysisRuntime(): Promise<ApiResponse<ReaAnalysisRuntime>>;
  reaAnalysisStart(input: ReaAnalysisInput): Promise<ApiResponse<ReaAnalysisJob>>;
  reaAnalysisGet(input: { readonly jobId: string }): Promise<ApiResponse<ReaAnalysisJob>>;
  reaAnalysisCancel(input: { readonly jobId: string }): Promise<ApiResponse<ReaAnalysisJob>>;
  reaAnalysisPrepareImport(input: ReaPrepareImportInput): Promise<ApiResponse<readonly unknown[]>>;
  onCuaSaveSnapshotRequested(listener: (request: CuaSaveSnapshotRequest) => void): () => void;
  cuaReportSaveSnapshot(report: CuaSaveSnapshotReport): Promise<ApiResponse<{ accepted: boolean }>>;
  onCuaSaveRequested(listener: (request: CuaSaveReadyRequest) => void): () => void;
  cuaAckSaveReady(ack: CuaSaveReadyAck): Promise<ApiResponse<{ accepted: boolean }>>;
  onCuaSaveFinished(listener: (result: CuaSaveResult) => void): () => void;
  cuaAckSaveCommit(ack: CuaSaveCommitAck): Promise<ApiResponse<{ accepted: boolean }>>;
  cuaAckCancel(ack: CuaCancelAck): Promise<ApiResponse<{ accepted: boolean }>>;
  cuaAckActionSettlement(ack: CuaActionSettlementAck): Promise<ApiResponse<{ accepted: boolean }>>;
  cuaAckPrepare(ack: CuaPrepareAck): Promise<ApiResponse<{ accepted: boolean }>>;
  cuaGetState(): Promise<ApiResponse<CuaState>>;
  cuaStop(): Promise<ApiResponse<CuaStopResult>>;
  cuaReportSurfaceSnapshot(snapshot: CuaSurfaceSnapshot, settlement?: CuaActionSettlementTag): Promise<ApiResponse<{ accepted: boolean }>>;
  onCuaStateChanged(listener: (state: CuaState) => void): () => void;
  shortsStart(input: ShortsStartInput): Promise<ApiResponse<ShortsJob>>;
  shortsGet(input: ShortsJobInput): Promise<ApiResponse<ShortsJob>>;
  shortsList(input: ShortsListInput): Promise<ApiResponse<readonly ShortsJob[]>>;
  shortsCancel(input: ShortsJobInput): Promise<ApiResponse<{ accepted: boolean }>>;
  shortsMaterialize(input: ShortsMaterializeInput): Promise<ApiResponse<ShortsJob>>;
  shortsExport(input: ShortsExportInput): Promise<ApiResponse<ShortsJob>>;
  getTitleFontData(request: TitleFontRequest): Promise<ApiResponse<TitleFontData>>;
  performWindowMenuAction(action: WindowMenuAction): void;
  onTimelineMenuCommand(listener: (commandId: TimelineMenuCommandId) => void): () => void;
  onProjectTimelineChanged(listener: (projectId: string) => void): () => void;
  updateTimelineMenuState(state: TimelineMenuState): void;
  getSettings(): Promise<ApiResponse<AppSettings>>;
  listSources(): Promise<ApiResponse<CaptureSource[]>>;
  selectSource(input: SelectSourceInput): Promise<ApiResponse<CaptureSource>>;
  getSelectedSource(): Promise<ApiResponse<CaptureSource | null>>;
  checkSelectedSource(input: SourceAvailabilityInput): Promise<ApiResponse<SourceAvailability>>;
  startRecording(input: StartRecordingInput): Promise<ApiResponse<RecordingSession>>;
  appendRecordingChunk(input: AppendRecordingChunkInput): Promise<ApiResponse<ChunkAck>>;
  finishRecording(input: FinishRecordingInput): Promise<ApiResponse<RecordingResult>>;
  abortRecording(input: AbortRecordingInput): Promise<ApiResponse<{ aborted: boolean }>>;
  openResult(input: ResultActionInput): Promise<ApiResponse<{ opened: boolean }>>;
  revealResult(input: ResultActionInput): Promise<ApiResponse<{ revealed: boolean }>>;
  listProjects(): Promise<ApiResponse<readonly LocalProjectSummary[]>>;
  createProject(input: CreateProjectInput): Promise<ApiResponse<CreateProjectResult>>;
  openProject(input: OpenProjectInput): Promise<ApiResponse<LocalProjectSnapshot>>;
  openProjectFolder(input?: { readonly projectType: import('../shared/projectTypes').ProjectType }): Promise<ApiResponse<OpenProjectFolderResult>>;
  deleteProject(input: DeleteProjectInput): Promise<ApiResponse<{ readonly deleted: boolean }>>;
  renameProject(input: { readonly projectId: string; readonly name: string }): Promise<ApiResponse<LocalProjectSnapshot>>;
  importProjectAssets(input: ImportProjectAssetsInput): Promise<ApiResponse<ImportProjectAssetsResult>>;
  importRecordingResultAsset(input: ImportRecordingResultAssetInput): Promise<ApiResponse<ImportProjectAssetsResult>>;
  updateAssetMetadata(input: UpdateAssetMetadataInput): Promise<ApiResponse<MediaAsset>>;
  detachVideoAudio(input: DetachVideoAudioInput): Promise<ApiResponse<DetachVideoAudioResult>>;
  getAssetPlaybackUrl(input: GetAssetPlaybackUrlInput): Promise<ApiResponse<AssetPlaybackUrl>>;
  saveTimeline(input: SaveTimelineInput): Promise<ApiResponse<LocalProjectSnapshot>>;
  saveAiProjectDocument(input: SaveAiProjectDocumentInput): Promise<ApiResponse<LocalProjectSnapshot>>;
  getFfmpegRuntimeStatus(): Promise<ApiResponse<LocalFfmpegRuntimeStatus>>;
  startExportJob(input: StartExportJobInput): Promise<ApiResponse<LocalExportJob>>;
  getExportJob(input: ExportJobActionInput): Promise<ApiResponse<LocalExportJob>>;
  cancelExportJob(input: ExportJobActionInput): Promise<ApiResponse<{ readonly cancelled: boolean }>>;
  openExportResult(input: ExportJobActionInput): Promise<ApiResponse<{ readonly opened: boolean }>>;
  revealExportResult(input: ExportJobActionInput): Promise<ApiResponse<{ readonly revealed: boolean }>>;
  getTranscriptionRuntimeStatus(): Promise<ApiResponse<WhisperCppRuntimeStatus>>;
  startTranscription(input: StartTranscriptionInput): Promise<ApiResponse<TranscriptionJob>>;
  getTranscriptionJob(jobId: string): Promise<ApiResponse<TranscriptionJob>>;
  cancelTranscriptionJob(jobId: string): Promise<ApiResponse<{ readonly cancelled: boolean }>>;
  getProviderCredentialStatus(): Promise<ApiResponse<Record<string, boolean>>>;
  setProviderCredential(provider: string, apiKey: string): Promise<ApiResponse<{ readonly updated: boolean }>>;
  getChatGptOAuthStatus(): Promise<ApiResponse<ChatGptOAuthStatus>>;
  startChatGptOAuth(): Promise<ApiResponse<ChatGptOAuthStatus>>;
  cancelChatGptOAuth(): Promise<ApiResponse<ChatGptOAuthStatus>>;
  logoutChatGptOAuth(): Promise<ApiResponse<ChatGptOAuthStatus>>;
  openChatGptDeviceAuthorizationPage(): Promise<ApiResponse<{ readonly opened: boolean }>>;
  executeLlmPrompt(request: {
    modelId: string;
    prompt: string;
    systemPrompt?: string;
    ollamaBaseUrl?: string;
    openAiAuthMode?: OpenAiAuthMode;
  }): Promise<ApiResponse<{ ok: boolean; modelId: string; providerId: string; completion?: string; error?: string }>>;
  mcpGetTools(): Promise<ApiResponse<unknown>>;
  mcpExecuteTool(toolName: string, params: unknown): Promise<ApiResponse<unknown>>;
  agentChatSend(input: AgentChatSendInput): Promise<ApiResponse<AgentChatTurnState>>;
  agentChatCancel(input: AgentChatCancelInput): Promise<ApiResponse<AgentChatTurnState>>;
  agentChatApprove(input: AgentChatApprovalInput): Promise<ApiResponse<AgentChatTurnState>>;
  agentChatReset(input: AgentChatResetInput): Promise<ApiResponse<AgentChatTurnState>>;
  agentChatCompact(input: AgentChatCompactInput): Promise<ApiResponse<AgentChatTurnState>>;
  agentChatHistoryList(): Promise<ApiResponse<readonly AgentChatHistoryEntry[]>>;
  agentChatHistoryGet(input: AgentChatHistoryGetInput): Promise<ApiResponse<AgentChatStoredConversation | null>>;
  agentChatHistoryDelete(input: AgentChatHistoryGetInput): Promise<ApiResponse<boolean>>;
  onUpdaterStateChanged(listener: (snapshot: UpdaterSnapshot) => void): () => void;
  getUpdaterState(): Promise<ApiResponse<UpdaterSnapshot>>;
  checkForUpdates(): Promise<ApiResponse<UpdaterSnapshot>>;
  installUpdate(): Promise<ApiResponse<UpdaterSnapshot>>;
}

export type UpdaterSnapshot = {
  readonly state: UpdaterState;
  readonly currentVersion: string;
};

// Pushed state crosses the bridge as unknown; anything that is not a shaped
// snapshot is dropped rather than handed to the renderer as one.
function parseUpdaterSnapshot(payload: unknown): UpdaterSnapshot | null {
  const candidate = payload as { state?: { status?: unknown }; currentVersion?: unknown } | null;
  if (typeof candidate?.state?.status !== 'string') return null;
  if (typeof candidate.currentVersion !== 'string') return null;
  return candidate as UpdaterSnapshot;
}

const videoTool: VideoToolApi = {
  reaAnalysisRuntime: () => ipcRenderer.invoke(REA_ANALYSIS_CHANNELS.runtime),
  reaGenerationStatus: () => ipcRenderer.invoke(REA_GENERATION_CHANNELS.status),
  reaGenerationSetCredential: input => ipcRenderer.invoke(REA_GENERATION_CHANNELS.setCredential, input),
  reaGenerationClearCredential: () => ipcRenderer.invoke(REA_GENERATION_CHANNELS.clearCredential),
  reaGenerationPrepare: input => ipcRenderer.invoke(REA_GENERATION_CHANNELS.prepare, input),
  reaGenerationGet: input => ipcRenderer.invoke(REA_GENERATION_CHANNELS.get, input),
  reaGenerationCancel: input => ipcRenderer.invoke(REA_GENERATION_CHANNELS.cancel, input),
  reaAnalysisStart: input => ipcRenderer.invoke(REA_ANALYSIS_CHANNELS.start, input),
  reaAnalysisGet: input => ipcRenderer.invoke(REA_ANALYSIS_CHANNELS.get, input),
  reaAnalysisCancel: input => ipcRenderer.invoke(REA_ANALYSIS_CHANNELS.cancel, input),
  reaAnalysisPrepareImport: input => ipcRenderer.invoke(REA_ANALYSIS_CHANNELS.prepareImport, input),
  onCuaSaveSnapshotRequested: listener => {
    const subscription = (_event: IpcRendererEvent, request: CuaSaveSnapshotRequest): void => listener(request);
    ipcRenderer.on(IPC_CHANNELS.cuaSaveSnapshotRequested, subscription);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.cuaSaveSnapshotRequested, subscription);
  },
  cuaReportSaveSnapshot: report => ipcRenderer.invoke(IPC_CHANNELS.cuaReportSaveSnapshot, report) as Promise<ApiResponse<{ accepted: boolean }>>,
  onCuaSaveRequested: listener => {
    const subscription = (_event: IpcRendererEvent, request: CuaSaveReadyRequest): void => listener(request);
    ipcRenderer.on(IPC_CHANNELS.cuaSaveRequested, subscription);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.cuaSaveRequested, subscription);
  },
  cuaAckSaveReady: ack => ipcRenderer.invoke(IPC_CHANNELS.cuaAckSaveReady, ack) as Promise<ApiResponse<{ accepted: boolean }>>,
  onCuaSaveFinished: listener => {
    const subscription = (_event: IpcRendererEvent, result: CuaSaveResult): void => listener(result);
    ipcRenderer.on(IPC_CHANNELS.cuaSaveFinished, subscription);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.cuaSaveFinished, subscription);
  },
  cuaAckSaveCommit: ack => ipcRenderer.invoke(IPC_CHANNELS.cuaAckSaveCommit, ack) as Promise<ApiResponse<{ accepted: boolean }>>,
  cuaAckCancel: ack => ipcRenderer.invoke(IPC_CHANNELS.cuaAckCancel, ack) as Promise<ApiResponse<{ accepted: boolean }>>,
  cuaAckActionSettlement: ack => ipcRenderer.invoke(IPC_CHANNELS.cuaAckActionSettlement, ack) as Promise<ApiResponse<{ accepted: boolean }>>,
  cuaAckPrepare: ack => ipcRenderer.invoke(IPC_CHANNELS.cuaAckPrepare, ack) as Promise<ApiResponse<{ accepted: boolean }>>,
  cuaGetState: () => ipcRenderer.invoke(IPC_CHANNELS.cuaGetState) as Promise<ApiResponse<CuaState>>,
  cuaStop: () => ipcRenderer.invoke(IPC_CHANNELS.cuaStop) as Promise<ApiResponse<CuaStopResult>>,
  cuaReportSurfaceSnapshot: (snapshot, settlement) => ipcRenderer.invoke(IPC_CHANNELS.cuaReportSurfaceSnapshot, snapshot, settlement) as Promise<ApiResponse<{ accepted: boolean }>>,
  onCuaStateChanged: listener => {
    const subscription = (_event: IpcRendererEvent, state: CuaState): void => listener(state);
    ipcRenderer.on(IPC_CHANNELS.cuaStateChanged, subscription);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.cuaStateChanged, subscription);
  },
  getJevConfig: () => ipcRenderer.invoke(JEV_CONFIG_CHANNELS.get),
  setJevConfig: (config) => ipcRenderer.invoke(JEV_CONFIG_CHANNELS.set, config),
  getJevCredentialStatus: () => ipcRenderer.invoke(JEV_CREDENTIAL_CHANNELS.status),
  setJevCredential: (apiKey) => ipcRenderer.invoke(JEV_CREDENTIAL_CHANNELS.set, apiKey),
  clearJevCredential: () => ipcRenderer.invoke(JEV_CREDENTIAL_CHANNELS.clear),
  shortsStart: input => ipcRenderer.invoke(IPC_CHANNELS.shortsStart, input) as Promise<ApiResponse<ShortsJob>>,
  shortsGet: input => ipcRenderer.invoke(IPC_CHANNELS.shortsGet, input) as Promise<ApiResponse<ShortsJob>>,
  shortsList: input => ipcRenderer.invoke(IPC_CHANNELS.shortsList, input) as Promise<ApiResponse<readonly ShortsJob[]>>,
  shortsCancel: input => ipcRenderer.invoke(IPC_CHANNELS.shortsCancel, input) as Promise<ApiResponse<{ accepted: boolean }>>,
  shortsMaterialize: input => ipcRenderer.invoke(IPC_CHANNELS.shortsMaterialize, input) as Promise<ApiResponse<ShortsJob>>,
  shortsExport: input => ipcRenderer.invoke(IPC_CHANNELS.shortsExport, input) as Promise<ApiResponse<ShortsJob>>,
  getTitleFontData: request => ipcRenderer.invoke(IPC_CHANNELS.getTitleFontData, request) as Promise<ApiResponse<TitleFontData>>,
  performWindowMenuAction: (action) => ipcRenderer.send(IPC_CHANNELS.windowMenuAction, action),
  onTimelineMenuCommand: (listener) => {
    const subscription = (_event: IpcRendererEvent, payload: unknown): void => {
      const commandId = parseTimelineMenuCommandId(payload);
      if (commandId !== null) listener(commandId);
    };
    ipcRenderer.on(IPC_CHANNELS.timelineMenuCommand, subscription);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.timelineMenuCommand, subscription);
  },
  onProjectTimelineChanged: (listener) => {
    const subscription = (_event: IpcRendererEvent, payload: unknown): void => {
      const projectId = (payload as { projectId?: unknown } | null)?.projectId;
      if (typeof projectId === 'string' && projectId.length > 0) listener(projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.projectTimelineChanged, subscription);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.projectTimelineChanged, subscription);
  },
  updateTimelineMenuState: (state) => ipcRenderer.send(IPC_CHANNELS.timelineMenuState, state),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings) as Promise<ApiResponse<AppSettings>>,
  listSources: () => ipcRenderer.invoke(IPC_CHANNELS.listSources) as Promise<ApiResponse<CaptureSource[]>>,
  selectSource: (input) => ipcRenderer.invoke(IPC_CHANNELS.selectSource, input) as Promise<ApiResponse<CaptureSource>>,
  getSelectedSource: () => ipcRenderer.invoke(IPC_CHANNELS.getSelectedSource) as Promise<ApiResponse<CaptureSource | null>>,
  checkSelectedSource: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkSelectedSource, input) as Promise<ApiResponse<SourceAvailability>>,
  startRecording: (input) => ipcRenderer.invoke(IPC_CHANNELS.startRecording, input) as Promise<ApiResponse<RecordingSession>>,
  appendRecordingChunk: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.appendRecordingChunk, input) as Promise<ApiResponse<ChunkAck>>,
  finishRecording: (input) => ipcRenderer.invoke(IPC_CHANNELS.finishRecording, input) as Promise<ApiResponse<RecordingResult>>,
  abortRecording: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.abortRecording, input) as Promise<ApiResponse<{ aborted: boolean }>>,
  openResult: (input) => ipcRenderer.invoke(IPC_CHANNELS.openResult, input) as Promise<ApiResponse<{ opened: boolean }>>,
  revealResult: (input) => ipcRenderer.invoke(IPC_CHANNELS.revealResult, input) as Promise<ApiResponse<{ revealed: boolean }>>,
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.projectsList) as Promise<ApiResponse<readonly LocalProjectSummary[]>>,
  createProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsCreate, input) as Promise<ApiResponse<CreateProjectResult>>,
  openProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsOpen, input) as Promise<ApiResponse<LocalProjectSnapshot>>,
  openProjectFolder: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsOpenFolder, input) as Promise<ApiResponse<OpenProjectFolderResult>>,
  deleteProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsDelete, input) as Promise<ApiResponse<{ readonly deleted: boolean }>>,
  renameProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsRename, input) as Promise<ApiResponse<LocalProjectSnapshot>>,
  importProjectAssets: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectAssetsImport, input) as Promise<ApiResponse<ImportProjectAssetsResult>>,
  importRecordingResultAsset: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecordingResultImport, input) as Promise<ApiResponse<ImportProjectAssetsResult>>,
  updateAssetMetadata: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectAssetMetadataUpdate, input) as Promise<ApiResponse<MediaAsset>>,
  detachVideoAudio: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectAssetDetachAudio, input) as Promise<ApiResponse<DetachVideoAudioResult>>,
  getAssetPlaybackUrl: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectAssetPlaybackUrl, input) as Promise<ApiResponse<AssetPlaybackUrl>>,
  saveTimeline: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectTimelineSave, input) as Promise<ApiResponse<LocalProjectSnapshot>>,
  saveAiProjectDocument: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectAiDocumentSave, input) as Promise<ApiResponse<LocalProjectSnapshot>>,
  getFfmpegRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getFfmpegRuntimeStatus) as Promise<ApiResponse<LocalFfmpegRuntimeStatus>>,
  startExportJob: (input) => ipcRenderer.invoke(IPC_CHANNELS.startExportJob, input) as Promise<ApiResponse<LocalExportJob>>,
  getExportJob: (input) => ipcRenderer.invoke(IPC_CHANNELS.getExportJob, input) as Promise<ApiResponse<LocalExportJob>>,
  cancelExportJob: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelExportJob, input) as Promise<ApiResponse<{ readonly cancelled: boolean }>>,
  openExportResult: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.openExportResult, input) as Promise<ApiResponse<{ readonly opened: boolean }>>,
  revealExportResult: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.revealExportResult, input) as Promise<ApiResponse<{ readonly revealed: boolean }>>,
  getTranscriptionRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.transcriptionRuntimeStatus) as Promise<ApiResponse<WhisperCppRuntimeStatus>>,
  startTranscription: (input) => ipcRenderer.invoke(IPC_CHANNELS.transcriptionStart, input) as Promise<ApiResponse<TranscriptionJob>>,
  getTranscriptionJob: (jobId) => ipcRenderer.invoke(IPC_CHANNELS.transcriptionGetJob, jobId) as Promise<ApiResponse<TranscriptionJob>>,
  cancelTranscriptionJob: (jobId) => ipcRenderer.invoke(IPC_CHANNELS.transcriptionCancelJob, jobId) as Promise<ApiResponse<{ readonly cancelled: boolean }>>,
  getProviderCredentialStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getProviderCredentials) as Promise<ApiResponse<Record<string, boolean>>>,
  setProviderCredential: (provider, apiKey) =>
    ipcRenderer.invoke(IPC_CHANNELS.setProviderCredential, provider, apiKey) as Promise<ApiResponse<{ readonly updated: boolean }>>,
  getChatGptOAuthStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getChatGptOAuthStatus) as Promise<ApiResponse<ChatGptOAuthStatus>>,
  startChatGptOAuth: () =>
    ipcRenderer.invoke(IPC_CHANNELS.startChatGptOAuth) as Promise<ApiResponse<ChatGptOAuthStatus>>,
  cancelChatGptOAuth: () =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelChatGptOAuth) as Promise<ApiResponse<ChatGptOAuthStatus>>,
  logoutChatGptOAuth: () =>
    ipcRenderer.invoke(IPC_CHANNELS.logoutChatGptOAuth) as Promise<ApiResponse<ChatGptOAuthStatus>>,
  openChatGptDeviceAuthorizationPage: () =>
    ipcRenderer.invoke(IPC_CHANNELS.openChatGptDeviceAuthorizationPage) as Promise<ApiResponse<{ readonly opened: boolean }>>,
  executeLlmPrompt: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.executeLlmPrompt, request) as Promise<
      ApiResponse<{ ok: boolean; modelId: string; providerId: string; completion?: string; error?: string }>
    >,
  mcpGetTools: () => ipcRenderer.invoke(IPC_CHANNELS.mcpGetTools) as Promise<ApiResponse<unknown>>,
  mcpExecuteTool: (toolName: string, params: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.mcpExecuteTool, toolName, params) as Promise<ApiResponse<unknown>>,
  agentChatSend: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentChatSend, input) as Promise<ApiResponse<AgentChatTurnState>>,
  agentChatCancel: input => ipcRenderer.invoke(IPC_CHANNELS.agentChatCancel, input) as Promise<ApiResponse<AgentChatTurnState>>,
  agentChatApprove: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentChatApprove, input) as Promise<ApiResponse<AgentChatTurnState>>,
  agentChatReset: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentChatReset, input) as Promise<ApiResponse<AgentChatTurnState>>,
  agentChatCompact: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentChatCompact, input) as Promise<ApiResponse<AgentChatTurnState>>,
  agentChatHistoryList: () =>
    ipcRenderer.invoke(IPC_CHANNELS.agentChatHistoryList) as Promise<ApiResponse<readonly AgentChatHistoryEntry[]>>,
  agentChatHistoryGet: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentChatHistoryGet, input) as Promise<ApiResponse<AgentChatStoredConversation | null>>,
  agentChatHistoryDelete: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentChatHistoryDelete, input) as Promise<ApiResponse<boolean>>,
  onUpdaterStateChanged: (listener) => {
    const subscription = (_event: IpcRendererEvent, payload: unknown): void => {
      const snapshot = parseUpdaterSnapshot(payload);
      if (snapshot !== null) listener(snapshot);
    };
    ipcRenderer.on(IPC_CHANNELS.updaterStateChanged, subscription);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updaterStateChanged, subscription);
  },
  getUpdaterState: () => ipcRenderer.invoke(IPC_CHANNELS.updaterGetState) as Promise<ApiResponse<UpdaterSnapshot>>,
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.updaterCheck) as Promise<ApiResponse<UpdaterSnapshot>>,
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updaterInstall) as Promise<ApiResponse<UpdaterSnapshot>>
};

contextBridge.exposeInMainWorld('videoTool', videoTool);
