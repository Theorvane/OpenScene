import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, session, shell, systemPreferences } from 'electron';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';

import { IPC_CHANNELS } from '../shared/ipc';
import type { AppSettings, CaptureSource } from '../shared/models';
import { SourceCatalog, type RawCaptureSource } from '../shared/sourceCatalog';
import type { MediaKind } from '../shared/timelineTypes';
import { installApplicationMenu } from './applicationMenu';
import { readTitleFontData } from './titleFontData';
import { executeRegisteredEditorTool } from './mcpToolDispatch';
import { AssetLibraryStore } from './assetLibraryStore';
import { registerAudioDetachIpcHandler } from './audioDetachIpcHandlers';
import { AudioDetachService } from './audioDetachService';
import { registerCaptureIpcHandlers } from './captureIpcHandlers';
import { registerExportIpcHandlers } from './exportIpcHandlers';
import { ExportIpcService } from './exportIpcService';
import { ExportJobStore } from './exportJobStore';
import { fail, ok } from './ipcResponses';
import { resolvePreloadScriptPath } from './preloadPath';
import { ProjectLocationRegistry } from './projectLocations';
import { ProjectStore } from './projectStore';
import { RecordingFileStore } from './recordingStore';
import { registerResultAssetImportHandlers } from './resultAssetImportHandlers';
import { ResultAssetImportService } from './resultAssetImportService';
import { registerTimelineAssetProtocol, registerTimelineAssetScheme } from './timelineAssetProtocol';
import { registerTimelineIpcHandlers } from './timelineIpcHandlers';
import { TimelineIpcService } from './timelineIpcService';
import { setupUpdater } from './updater';
import { registerUpdaterIpcHandlers } from './updaterIpcHandlers';
import { promptForUpdate, promptForUpdateState } from './updaterPrompt';

import { buildAgentChatGraph } from './agentChatGraph';
import { AgentChatHistoryStore } from './agentChatHistoryStore';
import { registerAgentChatIpcHandlers } from './agentChatIpcHandlers';
import { createAgentChatModel } from './agentChatModel';
import { AgentChatSessionManager } from './agentChatSession';
import { AGENT_CHAT_CUA_PER_CALL_TOOL_NAMES, AGENT_CHAT_SPEND_TOOL_NAMES, agentChatMutatingToolNames, createAgentChatTools } from './agentChatTools';
import { CuaDriver } from './cuaDriver';
import { registerCuaIpc } from './cuaIpc';
import { CuaAgentOrchestrator, CuaApprovalAuthority, type CuaAgentDriver } from './cuaAgentOrchestration';
import { ChatGptCodexAdapter } from './chatGptCodexAdapter';
import { ChatGptOAuthService } from './chatGptOAuthService';
import { CredentialStore } from './credentialStore';
import { LlmExecutionAdapter } from './llmAdapter';
import { LlmPromptRouter } from './llmPromptRouter';
import { getOpenVideoMcpDefinition, OpenVideoMcpServer } from './openVideoMcpServer';
import { registerChatGptOAuthIpcHandlers } from './registerChatGptOAuthIpcHandlers';
import { registerLlmPromptIpcHandler } from './registerLlmPromptIpcHandler';
import { registerTranscriptionIpcHandlers } from './transcriptionIpcHandlers';
import { TranscriptionService } from './transcriptionService';
import { ShortsService } from './shortsService';
import { createShortsCandidateProvider } from './shortsCandidateProvider';
import { discoverFfmpeg } from './ffmpegDiscovery';
import { measureExportedFile } from './exportMeasurement';

try {
  // Node loads the developer's local .env without bundling its secrets into
  // renderer code. Packaged installs normally have no such file and simply use
  // environment variables supplied by their launcher.
  if (!app.isPackaged) process.loadEnvFile(join(process.cwd(), '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.warn('[OpenScene] Local .env could not be loaded:', error instanceof Error ? error.message : 'unknown error');
  }
}

registerTimelineAssetScheme();

const sourceCatalog = new SourceCatalog();
const recordingStore = new RecordingFileStore(resolveRecordingsDirectory());
const projectLocations = new ProjectLocationRegistry(join(app.getPath('userData'), 'project-locations.json'));
const projectStore = new ProjectStore(join(app.getPath('userData'), 'projects'), projectLocations);
const assetLibraryStore = new AssetLibraryStore(join(app.getPath('userData'), 'projects'), projectStore);
const audioDetachService = new AudioDetachService({ projects: projectStore, assets: assetLibraryStore });
const exportJobStore = new ExportJobStore();
const credentialStore = new CredentialStore(app.getPath('userData'));
const updaterController = setupUpdater();
const updaterPromptIo = {
  showMessageBox: (input: Parameters<typeof dialog.showMessageBox>[0]) => dialog.showMessageBox(input),
  openExternal: (url: string) => shell.openExternal(url)
};
const chatGptOAuthService = new ChatGptOAuthService(app.getPath('userData'));
const llmExecutionAdapter = new LlmExecutionAdapter(credentialStore);
const llmPromptRouter = new LlmPromptRouter({
  apiKeyAdapter: llmExecutionAdapter,
  chatGptAdapter: new ChatGptCodexAdapter({ oauthService: chatGptOAuthService })
});
const timelineIpcService = new TimelineIpcService({
  projects: projectStore,
  assets: assetLibraryStore,
  selectMediaFiles: ({ acceptedKinds, extensions }) => dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: dialogFilters(acceptedKinds, extensions)
  }),
  selectProjectDirectory: () => dialog.showOpenDialog({
    title: 'Choose a project folder',
    properties: ['openDirectory', 'createDirectory']
  })
});
const transcriptionService = new TranscriptionService({
  getAsset: (projectId, assetId) => projectStore.getAsset(projectId, assetId),
  openAsset: (projectId, assetId) => timelineIpcService.openAssetPlaybackSource(projectId, assetId)
});
const resultAssetImportService = new ResultAssetImportService({
  assets: assetLibraryStore,
  resolveRecordingSource: (sessionId) => {
    const result = recordingStore.getResult(sessionId);
    return result === null
      ? null
      : { sourcePath: result.outputPath, displayName: result.fileName, kind: 'video', mimeType: 'video/webm' };
  }
});
const exportIpcService = new ExportIpcService({
  projects: projectStore,
  assets: assetLibraryStore,
  jobs: exportJobStore,
  exportsRoot: join(app.getPath('userData'), 'exports'),
  openPath: (path) => shell.openPath(path),
  revealPath: (path) => shell.showItemInFolder(path)
});

const shortsService = new ShortsService({
  projects: projectStore, assets: assetLibraryStore, exports: exportIpcService, transcription: transcriptionService,
  jobsDirectory: join(app.getPath('userData'), 'shorts-jobs'),
  providerFor: input => createShortsCandidateProvider(createAgentChatModel([], credentialStore, chatGptOAuthService)({
    modelId: input.modelId, openAiAuthMode: input.openAiAuthMode, ollamaBaseUrl: input.ollamaBaseUrl, reasoningEffort: input.reasoningEffort
  })),
  measureSource: async (projectId, assetId) => {
    const ffmpeg = await discoverFfmpeg();
    if (ffmpeg.kind === 'unavailable') throw new Error('Source inspection requires configured FFmpeg and FFprobe.');
    const source = await assetLibraryStore.openPlaybackSource(projectId, assetId);
    if (!source) throw new Error('The local source is unavailable.');
    try {
      const measured = await measureExportedFile({ ffmpegPath: ffmpeg.executablePath, filePath: source.filePath });
      if (!measured) throw new Error('Source inspection requires FFprobe beside FFmpeg.');
      return { durationMs: measured.durationMs, width: measured.widthPx, height: measured.heightPx };
    } finally { await source.file.close(); }
  }
});

function resolveRecordingsDirectory(): string {
  const override = process.env.VIDEO_TOOL_RECORDINGS_DIR;
  if (typeof override === 'string' && override.trim().length > 0) {
    return override;
  }

  return join(app.getPath('userData'), 'recordings');
}

function dialogFilters(acceptedKinds: readonly MediaKind[] | undefined, extensions: readonly string[]): Electron.FileFilter[] {
  if (acceptedKinds?.length === 1 && acceptedKinds[0] === 'image') {
    return [{ name: 'Images', extensions: ['jpeg', 'jpg', 'png', 'webp'] }];
  }
  if (acceptedKinds?.length === 1 && acceptedKinds[0] === 'audio') {
    return [{ name: 'Audio', extensions: ['m4a', 'mp3', 'wav', 'webm'] }];
  }
  if (acceptedKinds?.length === 1 && acceptedKinds[0] === 'video') {
    return [{ name: 'Video', extensions: ['mov', 'mp4', 'webm'] }];
  }
  return [{ name: 'Media', extensions: [...extensions] }];
}

function getScreenPermissionStatus(): string {
  if (process.platform !== 'darwin') {
    return 'not-required-by-platform';
  }

  return systemPreferences.getMediaAccessStatus('screen');
}

/**
 * Application identity set in code rather than inferred from package metadata.
 * macOS reads the application-menu title from the running bundle, so a dev run
 * still shows Electron; this is what a packaged build and the About panel use.
 */
const APP_NAME = 'OpenScene';
let cuaTarget: { window: BrowserWindow; driver: CuaDriver } | null = null;
let activeAgentChatSessions: AgentChatSessionManager | null = null;
const cuaAuthority = new CuaApprovalAuthority({ permitTtlMs: 2000, maxActionsPerRun: 20, now: () => performance.now() });
const requireCuaDriver = (): CuaDriver => {
  if (!cuaTarget || cuaTarget.window.isDestroyed()) throw new Error('CUA_TARGET_GONE');
  return cuaTarget.driver;
};
const cuaDriverAdapter: CuaAgentDriver = {
  observe: context => requireCuaDriver().observe(context),
  execute: (request, permit, signal) => requireCuaDriver().execute(request, permit, signal),
  cancel: reason => requireCuaDriver().cancel(reason),
  getState: () => requireCuaDriver().getState(),
  setExecutionBlocked: blocked => requireCuaDriver().setExecutionBlocked(blocked)
};
const cuaAgent = new CuaAgentOrchestrator(cuaAuthority, {
  driver: cuaDriverAdapter,
  onAbortConversation: id => activeAgentChatSessions?.abortConversation(id)
});

/** Window icon for platforms that take one; macOS uses the bundle icon. */
function appIconPath(): string | undefined {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png');
  return existsSync(iconPath) ? iconPath : undefined;
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: APP_NAME,
    ...(appIconPath() === undefined ? {} : { icon: appIconPath() as string }),
    backgroundColor: '#10100f',
    show: false,
    // macOS: hide the native titlebar so the renderer's product chrome acts as
    // the draggable top bar; traffic lights are repositioned to center in it.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 15 } }
      : {}),
    webPreferences: {
      preload: resolvePreloadScriptPath(__dirname),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  const cuaDriver = new CuaDriver(mainWindow, {
    getDeviceScaleFactor: () => screen.getDisplayMatching(mainWindow.getBounds()).scaleFactor,
    getPendingApproval: () => cuaAuthority.getPendingApproval(),
    consumePermit: (request, permit) => cuaAuthority.consume(request, permit),
    onCancel: ({ runId }) => {
      if (runId) { cuaAuthority.revokeRun(runId); cuaAgent.abortRun(runId); }
    },
    onState: state => {
      cuaAgent.settleRun(state);
      if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.cuaStateChanged, state);
    }
  });
  cuaTarget = { window: mainWindow, driver: cuaDriver };

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Keep native accelerators registered while the renderer draws Windows menus.
  if (process.platform === 'win32') mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.on('console-message', (details) => {
    if (details.level !== 'warning' && details.level !== 'error') return;
    const log = details.level === 'error' ? console.error : console.warn;
    log(`[OpenScene][Renderer] console.${details.level} ${JSON.stringify({
      message: details.message,
      source: details.sourceId,
      line: details.lineNumber
    })}`);
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[OpenScene][Renderer] preload.failed ${JSON.stringify({ preloadPath, error: error.message })}`);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(`[OpenScene][Renderer] load.failed ${JSON.stringify({ errorCode, errorDescription, url: validatedURL })}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[OpenScene][Renderer] process.gone ${JSON.stringify({ reason: details.reason, exitCode: details.exitCode })}`);
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (typeof devServerUrl === 'string' && devServerUrl.length > 0) {
    void mainWindow.loadURL(devServerUrl);
    return;
  }

  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

async function listWindowSources(): Promise<CaptureSource[]> {
  const electronSources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 360, height: 220 },
    fetchWindowIcons: true
  });

  const rawSources: RawCaptureSource[] = electronSources.map((source) => {
    const rawSource: RawCaptureSource = {
      id: source.id,
      name: source.name,
      thumbnailDataUrl: source.thumbnail.toDataURL()
    };

    if (typeof source.display_id === 'string' && source.display_id.length > 0) {
      rawSource.displayId = source.display_id;
    }

    return rawSource;
  });

  return sourceCatalog.refresh(rawSources);
}

async function isSourceStillAvailable(sourceId: string): Promise<boolean> {
  const electronSources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } });
  return electronSources.some((source) => source.id === sourceId);
}

function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    void (async () => {
      if (!request.videoRequested || request.audioRequested) {
        callback({});
        return;
      }

      const selectedSource = sourceCatalog.getSelected();
      if (selectedSource === null) {
        callback({});
        return;
      }

      const electronSources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } });
      const matchingSource = electronSources.find((source) => source.id === selectedSource.id);
      if (matchingSource === undefined) {
        sourceCatalog.clearSelected();
        callback({});
        return;
      }

      callback({ video: matchingSource });
    })().catch((error: unknown) => {
      console.error('Display media request failed:', error);
      callback({});
    });
  });
}

async function installIpcHandlers(): Promise<void> {
  registerCuaIpc(ipcMain, () => cuaTarget);
  ipcMain.handle(IPC_CHANNELS.getTitleFontData, (_event, input: unknown) => readTitleFontData(input));
  registerCaptureIpcHandlers({
    ipcMain,
    shell,
    sourceCatalog,
    recordingStore,
    getSettings: (): AppSettings => ({
      recordingsPath: recordingStore.directory,
      screenPermission: getScreenPermissionStatus(),
      platform: process.platform
    }),
    listWindowSources,
    isSourceStillAvailable
  });
  registerTimelineIpcHandlers(ipcMain, timelineIpcService);
  registerAudioDetachIpcHandler(ipcMain, audioDetachService);
  registerTranscriptionIpcHandlers(ipcMain, transcriptionService);
  registerResultAssetImportHandlers(ipcMain, resultAssetImportService);
  registerUpdaterIpcHandlers(ipcMain, {
    controller: updaterController,
    currentVersion: app.getVersion(),
    listWindows: () => BrowserWindow.getAllWindows()
  });
  registerExportIpcHandlers(ipcMain, exportIpcService);
  ipcMain.handle(IPC_CHANNELS.shortsStart, (_event, payload: unknown) => shortsService.start(payload));
  ipcMain.handle(IPC_CHANNELS.shortsGet, (_event, payload: unknown) => shortsService.get(payload));
  ipcMain.handle(IPC_CHANNELS.shortsList, (_event, payload: unknown) => shortsService.list(payload));
  ipcMain.handle(IPC_CHANNELS.shortsCancel, (_event, payload: unknown) => shortsService.cancel(payload));
  ipcMain.handle(IPC_CHANNELS.shortsMaterialize, (_event, payload: unknown) => shortsService.materialize(payload));
  ipcMain.handle(IPC_CHANNELS.shortsExport, (_event, payload: unknown) => shortsService.export(payload));
  registerChatGptOAuthIpcHandlers({
    service: chatGptOAuthService,
    openDeviceAuthorizationPage: (url) => shell.openExternal(url),
    registerHandler: (channel, handler) => ipcMain.handle(channel, (_event, payload: unknown) => handler(payload))
  });
  registerLlmPromptIpcHandler({
    router: llmPromptRouter,
    registerHandler: (channel, handler) => ipcMain.handle(channel, (_event, payload: unknown) => handler(payload))
  });

  ipcMain.handle(IPC_CHANNELS.getProviderCredentials, async () => {
    try {
      const status = await credentialStore.getCredentialStatus();
      return ok(status);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to retrieve credential status');
    }
  });

  ipcMain.handle(IPC_CHANNELS.setProviderCredential, async (_event, provider: any, apiKey: string) => {
    try {
      await credentialStore.setCredential(provider, apiKey);
      return ok({ updated: true });
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to save credential');
    }
  });

  const mcpServerInstance = new OpenVideoMcpServer();
  mcpServerInstance.setServices(projectStore, exportIpcService);
  mcpServerInstance.setTranscriptionService(transcriptionService);
  // Agent tools write the project straight to disk; tell open editors to reload
  // so the change shows up on the timeline instead of being silently shadowed.
  mcpServerInstance.setProjectTimelineChangeNotifier((projectId) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.projectTimelineChanged, { projectId });
    }
  });

  ipcMain.handle(IPC_CHANNELS.mcpGetTools, async () => {
    try {
      const definition = getOpenVideoMcpDefinition();
      return ok(definition);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to inspect MCP tools');
    }
  });

  ipcMain.handle(IPC_CHANNELS.mcpExecuteTool, async (_event, toolName: string, params: unknown) => {
    return executeRegisteredEditorTool(mcpServerInstance, toolName, params);
  });

  const agentChatTools = await createAgentChatTools(mcpServerInstance, cuaAgent);
  const agentChatGraphBundle = buildAgentChatGraph({
    tools: agentChatTools,
    // Derived from the tools that exist, so a tool added tomorrow asks for
    // approval by default rather than because someone remembered a list.
    mutatingToolNames: agentChatMutatingToolNames(agentChatTools),
    spendToolNames: AGENT_CHAT_SPEND_TOOL_NAMES,
    perCallApprovalToolNames: AGENT_CHAT_CUA_PER_CALL_TOOL_NAMES,
    cua: cuaAgent,
    createModel: createAgentChatModel(agentChatTools, credentialStore, chatGptOAuthService)
  });
  const agentChatSessions = new AgentChatSessionManager(agentChatGraphBundle, { cancelCua: id => cuaAgent.cancelConversation(id) });
  activeAgentChatSessions = agentChatSessions;
  registerAgentChatIpcHandlers(ipcMain, agentChatSessions, new AgentChatHistoryStore(projectStore), {
    cancelChannel: IPC_CHANNELS.agentChatCancel,
    isTrustedSender: event => cuaTarget !== null && !cuaTarget.window.isDestroyed()
      && event.sender === cuaTarget.window.webContents && event.senderFrame === cuaTarget.window.webContents.mainFrame
  });
}

app.setName(APP_NAME);
app.setAboutPanelOptions({
  applicationName: APP_NAME,
  applicationVersion: app.getVersion(),
  copyright: 'Open source under the MIT License'
});

app.whenReady().then(async () => {
  installApplicationMenu(() => {
    // The user asked, so an up-to-date or failed answer is reported here where
    // the startup path stays quiet about both.
    void promptForUpdate(updaterController, { reportNothingToDo: true, ...updaterPromptIo }).catch((error: unknown) => {
      console.error('Update check failed:', error);
    });
  });
  installDisplayMediaHandler();
  registerTimelineAssetProtocol({
    openAssetPlaybackSource: (projectId, assetId) => timelineIpcService.openAssetPlaybackSource(projectId, assetId)
  });
  await installIpcHandlers();
  createWindow();

  // Checked after the window exists so the first result has somewhere to land,
  // and left unawaited so a slow or unreachable GitHub never delays startup.
  // Silent unless there is an update to act on: a launch that announces "up to
  // date" trains the user to dismiss the box that also carries the real one.
  void updaterController
    .start()
    // start() already checked; prompting from its result avoids a second
    // network round trip on every launch.
    .then((state) => promptForUpdateState(updaterController, state, { reportNothingToDo: false, ...updaterPromptIo }))
    .catch((error: unknown) => {
      console.error('Update check failed:', error);
    });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error: unknown) => {
  console.error('Electron startup failed:', error);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let shortsShutdownComplete = false;
app.on('before-quit', event => {
  if (shortsShutdownComplete) return;
  event.preventDefault();
  exportIpcService.cancelAll();
  void Promise.allSettled([cuaTarget?.driver.cancel('app-quit'), shortsService.shutdown()]).finally(() => {
    shortsShutdownComplete = true;
    app.quit();
  });
});
