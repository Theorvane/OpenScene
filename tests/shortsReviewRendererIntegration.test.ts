import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import type { ExportIpcService } from '../src/main/exportIpcService';
import { ProjectStore } from '../src/main/projectStore';
import { ShortsService } from '../src/main/shortsService';
import type { TranscriptionService } from '../src/main/transcriptionService';
import type { LocalExportJob } from '../src/shared/exportTypes';
import type { ApiResponse } from '../src/shared/models';
import type { ShortsSelectionProvider } from '../src/shared/shortsCandidateSelection';
import type { ShortsJob } from '../src/shared/shortsTypes';
import {
  aggregateShortsExports,
  findRecipeForCandidate,
  getPrimaryShortsClip,
  getShortsErrorGuidance,
  getShortsSelectionNotice,
  shouldPollShortsJob,
  updateShortsClipSourceRange,
  updateShortsClipTransform,
  updateShortsTitle
} from '../src/renderer/src/editor/shorts/shortsReviewState';

const tempRoots: string[] = [];
afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

function unwrap<T>(response: ApiResponse<T>): T {
  if (!response.ok) throw new Error(response.error.message);
  return response.value;
}

async function waitForSettled(service: ShortsService, jobId: string): Promise<ShortsJob> {
  for (let i = 0; i < 500; i += 1) {
    const job = unwrap(await service.get({ jobId }));
    if (job.cleanupComplete) return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Shorts job ${jobId} did not settle.`);
}

async function loadRendererComponent<TProps extends Record<string, unknown>>(
  relativePath: string,
  exportName: string
): Promise<ComponentType<TProps>> {
  const mod = (await import(relativePath)) as Record<string, ComponentType<TProps>>;
  const component = mod[exportName];
  if (component === undefined) {
    throw new Error(`Missing component export ${exportName} from ${relativePath}`);
  }
  return component;
}

describe('shorts review UI + real ShortsService contract & React render integration', () => {
  it('renders real React components against real ShortsService review, materialize, inline edit, and batch export retry flow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shorts-ui-int-'));
    tempRoots.push(root);

    const ShortsCandidatePreview = await loadRendererComponent(
      '../src/renderer/src/editor/shorts/ShortsCandidatePreview.tsx',
      'ShortsCandidatePreview'
    );
    const ShortsResultEditor = await loadRendererComponent(
      '../src/renderer/src/editor/shorts/ShortsResultEditor.tsx',
      'ShortsResultEditor'
    );
    const ShortsBatchExportPanel = await loadRendererComponent(
      '../src/renderer/src/editor/shorts/ShortsBatchExportPanel.tsx',
      'ShortsBatchExportPanel'
    );

    const projects = new ProjectStore(join(root, 'projects'));
    const assets = new AssetLibraryStore(join(root, 'projects'), projects);
    const sourceProject = await projects.create({ name: 'Long Stream' });
    const sourcePath = join(root, 'stream.mp4');
    await writeFile(sourcePath, 'synthetic video bytes');
    const imported = await assets.import({
      projectId: sourceProject.id,
      sourcePath,
      displayName: 'Stream.mp4',
      kind: 'video',
      mimeType: 'video/mp4'
    });
    const sourceAsset = await assets.updateMetadata({
      projectId: sourceProject.id,
      assetId: imported.id,
      durationMs: 30_000,
      width: 1920,
      height: 1080
    });
    const cues = [
      { id: 'cue-1', text: 'First highlight hook.', startMs: 1_000, endMs: 8_000 },
      { id: 'cue-2', text: 'Second highlight payoff.', startMs: 12_000, endMs: 20_000 }
    ];
    await projects.saveAiProjectDocument(sourceProject.id, {
      ...sourceProject.ai,
      transcriptionDraft: {
        id: 'td-1',
        sourceAssetId: sourceAsset.id,
        engine: 'whisper.cpp',
        modelName: 'fixture',
        language: 'en',
        createdAt: new Date().toISOString(),
        status: 'approved',
        cues
      }
    });

    const provider: ShortsSelectionProvider = async () => ({
      candidates: cues.map((cue) => ({
        firstEvidenceId: cue.id,
        lastEvidenceId: cue.id,
        reason: `Strong moment: ${cue.text}`,
        evidenceIds: [cue.id],
        context: { completeThought: true, notes: 'Grounded passage.' }
      }))
    });

    let exportSeq = 0;
    const makeExportJob = (jobId: string, failed: boolean): LocalExportJob => ({
      id: jobId,
      projectId: 'res',
      createdAt: '2026-11-24T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:01.000Z',
      state: failed
        ? { kind: 'failed', failedAt: '2026-11-24T00:00:01.000Z', reason: 'FFmpeg encoder libx264 unavailable. Configure VIDEO_TOOL_FFMPEG_PATH.' }
        : { kind: 'completed', completedAt: '2026-11-24T00:00:01.000Z', fileName: `${jobId}.mp4`, fileSizeBytes: 2048 }
    });

    const exportService = {
      startExportJob: vi.fn(async (input: { projectId: string }) => {
        const id = `exp-${++exportSeq}`;
        return {
          ok: true as const,
          value: {
            id,
            projectId: input.projectId,
            createdAt: '2026-11-24T00:00:00.000Z',
            updatedAt: '2026-11-24T00:00:00.000Z',
            state: { kind: 'queued' as const, queuedAt: '2026-11-24T00:00:00.000Z' }
          }
        };
      }),
      getExportJob: vi.fn(async ({ jobId }: { jobId: string }): Promise<ApiResponse<LocalExportJob>> => ({
        ok: true,
        value: makeExportJob(jobId, jobId === 'exp-2')
      })),
      isSettled: vi.fn(() => true),
      cancelExportJob: vi.fn(async () => ({ ok: true as const, value: { cancelled: true } }))
    };

    const transcriptionService = {
      runtimeStatus: vi.fn(async () => ({ ready: true })),
      start: vi.fn(),
      get: vi.fn(),
      isSettled: vi.fn(() => true),
      cancel: vi.fn()
    };

    const shortsService = new ShortsService({
      projects,
      assets,
      exports: exportService as unknown as ExportIpcService,
      transcription: transcriptionService as unknown as TranscriptionService,
      jobsDirectory: join(root, 'shorts-jobs'),
      providerFor: () => provider,
      measureSource: async () => ({ durationMs: 30_000, width: 1920, height: 1080 }),
      pollMs: 1
    });

    // 1. Start selection and verify pre-materialize React preview + editor rendering.
    const started = unwrap(
      await shortsService.start({
        projectId: sourceProject.id,
        assetId: sourceAsset.id,
        modelId: 'fixture-model',
        requestedCount: 2,
        minDurationMs: 2_000,
        maxDurationMs: 15_000
      })
    );
    const reviewed = await waitForSettled(shortsService, started.id);
    expect(reviewed.stage).toBe('review');
    const firstCandidate = reviewed.selection!.candidates[0]!;

    const prePreviewHtml = renderToStaticMarkup(
      createElement(ShortsCandidatePreview, {
        sourceProjectId: sourceProject.id,
        sourceAsset,
        candidate: firstCandidate,
        sourceCaptions: reviewed.captions,
        recipe: findRecipeForCandidate(reviewed, firstCandidate.id),
        resultProject: null
      })
    );
    expect(prePreviewHtml).toContain('data-testid="shorts-crop-viewport"');
    expect(prePreviewHtml).toContain('9:16 캔버스 (Contain · 얼굴추적 미포함)');
    expect(prePreviewHtml).toContain('data-testid="shorts-recipe-meta"');

    const preEditorHtml = renderToStaticMarkup(
      createElement(ShortsResultEditor, {
        candidate: firstCandidate,
        sourceCaptions: reviewed.captions,
        resultProjectId: undefined,
        resultProject: null,
        isLoadingResult: false,
        isSavingResult: false,
        isDirty: false,
        statusMessage: null,
        onChangeTimeline: () => undefined,
        onSaveTimeline: () => undefined,
        onOpenInTimelineEditor: () => undefined
      })
    );
    expect(preEditorHtml).toContain('data-testid="shorts-preview-caption-list"');
    expect(preEditorHtml).toContain('First highlight hook.');

    // 2. Materialize both candidates into isolated result projects.
    unwrap(
      await shortsService.materialize({
        jobId: reviewed.id,
        candidateIds: reviewed.selection!.candidates.map((c) => c.id)
      })
    );
    const materialized = await waitForSettled(shortsService, reviewed.id);
    expect(materialized.stage).toBe('completed');
    const firstResultId = materialized.items[0]!.resultProjectId!;
    const secondResultId = materialized.items[1]!.resultProjectId!;

    // 3. Open isolated resultProjectId, apply inline trim + manual 9:16 transform + subtitle edit, save via ProjectStore.
    const openedResult = await projects.open(firstResultId);
    expect(openedResult).not.toBeNull();
    const clip = getPrimaryShortsClip(openedResult!.timeline)!;
    const editedTimeline = updateShortsTitle(
      updateShortsClipTransform(
        updateShortsClipSourceRange(openedResult!.timeline, {
          clipId: clip.id,
          sourceStartMs: 1_500,
          sourceEndMs: 7_500
        })!,
        clip.id,
        { positionX: 120, positionY: -20, scale: 1.5 }
      )!,
      openedResult!.timeline.titles![0]!.id,
      { text: 'Reviewed Korean 자막' }
    )!;
    const savedResult = await projects.saveTimeline(firstResultId, editedTimeline);
    expect(savedResult.timeline.titles?.[0]?.text).toBe('Reviewed Korean 자막');

    // Render post-materialize ShortsResultEditor & ShortsCandidatePreview via real React.
    const postEditorHtml = renderToStaticMarkup(
      createElement(ShortsResultEditor, {
        candidate: firstCandidate,
        sourceCaptions: reviewed.captions,
        resultProjectId: firstResultId,
        resultProject: savedResult,
        isLoadingResult: false,
        isSavingResult: false,
        isDirty: false,
        statusMessage: 'Saved',
        onChangeTimeline: () => undefined,
        onSaveTimeline: () => undefined,
        onOpenInTimelineEditor: () => undefined
      })
    );
    expect(postEditorHtml).toContain('data-testid="shorts-trim-start-input"');
    expect(postEditorHtml).toContain('data-testid="shorts-crop-offset-x-input"');
    expect(postEditorHtml).toContain('value="120"');
    expect(postEditorHtml).toContain('Reviewed Korean 자막');
    expect(postEditorHtml).toContain(`data-testid="shorts-open-in-editor-btn-${firstCandidate.id}"`);

    const postPreviewHtml = renderToStaticMarkup(
      createElement(ShortsCandidatePreview, {
        sourceProjectId: sourceProject.id,
        sourceAsset,
        candidate: firstCandidate,
        sourceCaptions: reviewed.captions,
        recipe: findRecipeForCandidate(materialized, firstCandidate.id),
        resultProject: savedResult,
        onUpdateTransform: () => undefined
      })
    );
    expect(postPreviewHtml).toContain('data-draggable="true"');
    expect(postPreviewHtml).toContain('수동 9:16 Transform (얼굴추적 미포함)');

    // 4. Batch export -> partial failure -> failed-only retry preserves first success -> render BatchExportPanel.
    const batch1 = await waitForSettled(
      shortsService,
      unwrap(await shortsService.export({ jobId: materialized.id, resultProjectIds: [firstResultId, secondResultId] })).id
    );
    expect(batch1.stage).toBe('partial');

    const exp1 = unwrap(await exportService.getExportJob({ jobId: 'exp-1' }));
    const exp2 = unwrap(await exportService.getExportJob({ jobId: 'exp-2' }));
    const partialSummary = aggregateShortsExports({
      reviewJob: materialized,
      exportRuns: [batch1],
      exportJobsById: { 'exp-1': exp1, 'exp-2': exp2 },
      unavailableExportJobIds: new Set()
    });
    expect(partialSummary.failedResultProjectIds).toEqual([secondResultId]);
    expect(partialSummary.items[1]?.error).toContain('VIDEO_TOOL_FFMPEG_PATH');

    const partialExportHtml = renderToStaticMarkup(
      createElement(ShortsBatchExportPanel, {
        summary: partialSummary,
        selectedResultProjectIds: [firstResultId, secondResultId],
        isStartingExport: false,
        isCancellingExport: false,
        exportActionNotice: null,
        activeExportRuns: [batch1],
        onToggleSelectAll: () => undefined,
        onToggleItem: () => undefined,
        onStartBatchExport: () => undefined,
        onRetryFailed: () => undefined,
        onCancelExport: () => undefined,
        onOpenExportResult: () => undefined,
        onRevealExportResult: () => undefined
      })
    );
    expect(partialExportHtml).toContain('data-testid="shorts-export-retry-failed-btn"');
    expect(partialExportHtml).toContain(`data-testid="shorts-export-item-error-${secondResultId}"`);
    expect(partialExportHtml).toContain('VIDEO_TOOL_FFMPEG_PATH');
    expect(partialExportHtml).toContain(`data-testid="shorts-export-item-open-${firstResultId}"`);
    expect(partialExportHtml).toContain(`data-testid="shorts-export-item-reveal-${firstResultId}"`);

    const batch2 = await waitForSettled(
      shortsService,
      unwrap(await shortsService.export({ jobId: materialized.id, resultProjectIds: partialSummary.failedResultProjectIds })).id
    );
    expect(batch2.stage).toBe('completed');
    expect(batch2.parentJobId).toBe(materialized.id);

    const exp3 = unwrap(await exportService.getExportJob({ jobId: 'exp-3' }));
    const completedSummary = aggregateShortsExports({
      reviewJob: materialized,
      exportRuns: [batch1, batch2],
      exportJobsById: { 'exp-1': exp1, 'exp-3': exp3 },
      unavailableExportJobIds: new Set()
    });
    expect(completedSummary.completedCount).toBe(2);
    expect(completedSummary.failedResultProjectIds).toEqual([]);
  });

  it('handles transcription_not_configured, insufficient-evidence, cancellation cleanupComplete, and interrupted restoration via real ShortsService', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shorts-ui-states-'));
    tempRoots.push(root);

    const projects = new ProjectStore(join(root, 'projects'));
    const assets = new AssetLibraryStore(join(root, 'projects'), projects);
    const project = await projects.create({ name: 'Edge States' });
    const sourcePath = join(root, 'edge.mp4');
    await writeFile(sourcePath, 'synthetic video bytes');
    const imported = await assets.import({
      projectId: project.id,
      sourcePath,
      displayName: 'Edge.mp4',
      kind: 'video',
      mimeType: 'video/mp4'
    });
    const asset = await assets.updateMetadata({
      projectId: project.id,
      assetId: imported.id,
      durationMs: 20_000,
      width: 1920,
      height: 1080
    });

    const transcriptionNotConfigured = {
      runtimeStatus: vi.fn(async () => ({ ready: false })),
      start: vi.fn(),
      get: vi.fn(),
      isSettled: vi.fn(() => true),
      cancel: vi.fn()
    };
    const exportMock = {
      startExportJob: vi.fn(),
      getExportJob: vi.fn(),
      isSettled: vi.fn(() => true),
      cancelExportJob: vi.fn()
    };

    const configService = new ShortsService({
      projects,
      assets,
      exports: exportMock as unknown as ExportIpcService,
      transcription: transcriptionNotConfigured as unknown as TranscriptionService,
      jobsDirectory: join(root, 'jobs-config'),
      providerFor: () => async () => ({ candidates: [] }),
      measureSource: async () => ({ durationMs: 20_000, width: 1920, height: 1080 }),
      pollMs: 1
    });

    const configFailed = await waitForSettled(
      configService,
      unwrap(await configService.start({ projectId: project.id, assetId: asset.id, modelId: 'fixture' })).id
    );
    expect(configFailed.errorCode).toBe('transcription_not_configured');
    expect(getShortsErrorGuidance(configFailed)).toMatchObject({ openSettings: true });

    // Seed transcript to test insufficient-evidence and cancellation cleanupComplete.
    await projects.saveAiProjectDocument(project.id, {
      ...project.ai,
      transcriptionDraft: {
        id: 'td-edge',
        sourceAssetId: asset.id,
        engine: 'whisper.cpp',
        modelName: 'fixture',
        language: 'en',
        createdAt: new Date().toISOString(),
        status: 'approved',
        cues: [{ id: 'c1', text: 'Short utterance.', startMs: 0, endMs: 4_000 }]
      }
    });

    const emptyService = new ShortsService({
      projects,
      assets,
      exports: exportMock as unknown as ExportIpcService,
      transcription: transcriptionNotConfigured as unknown as TranscriptionService,
      jobsDirectory: join(root, 'jobs-empty'),
      providerFor: () => async () => ({ candidates: [] }),
      measureSource: async () => ({ durationMs: 20_000, width: 1920, height: 1080 }),
      pollMs: 1
    });
    const emptyReview = await waitForSettled(
      emptyService,
      unwrap(await emptyService.start({ projectId: project.id, assetId: asset.id, modelId: 'fixture', minDurationMs: 1_000, maxDurationMs: 10_000 })).id
    );
    expect(emptyReview.stage).toBe('review');
    expect(getShortsSelectionNotice(emptyReview)).toMatchObject({ kind: 'empty' });
    expect(getShortsErrorGuidance(emptyReview)).toBeNull();

    // Cancellation: accepted !== cleanupComplete until provider settles.
    let releaseProvider!: (value: unknown) => void;
    let providerInvoked = false;
    const cancelService = new ShortsService({
      projects,
      assets,
      exports: exportMock as unknown as ExportIpcService,
      transcription: transcriptionNotConfigured as unknown as TranscriptionService,
      jobsDirectory: join(root, 'jobs-cancel'),
      providerFor: () => async () => {
        providerInvoked = true;
        return new Promise((resolve) => {
          releaseProvider = resolve;
        });
      },
      measureSource: async () => ({ durationMs: 20_000, width: 1920, height: 1080 }),
      pollMs: 1
    });
    const running = unwrap(await cancelService.start({ projectId: project.id, assetId: asset.id, modelId: 'fixture', minDurationMs: 1_000, maxDurationMs: 10_000 }));
    while (!providerInvoked) await new Promise((resolve) => setTimeout(resolve, 1));
    const cancelAck = unwrap(await cancelService.cancel({ jobId: running.id }));
    expect(cancelAck).toEqual({ accepted: true });
    const midCancel = unwrap(await cancelService.get({ jobId: running.id }));
    expect(midCancel.stage).toBe('cancelling');
    expect(midCancel.cleanupComplete).toBe(false);
    expect(shouldPollShortsJob(midCancel)).toBe(true);

    releaseProvider({ candidates: [] });
    const settledCancel = await waitForSettled(cancelService, running.id);
    expect(settledCancel.stage).toBe('cancelled');
    expect(settledCancel.cleanupComplete).toBe(true);
    expect(shouldPollShortsJob(settledCancel)).toBe(false);
  });
});
