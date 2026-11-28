import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';
import { ProjectStore } from '../src/main/projectStore';
import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { ExportIpcService } from '../src/main/exportIpcService';
import { ExportJobStore } from '../src/main/exportJobStore';
import { ShortsService } from '../src/main/shortsService';
import type { TranscriptionService } from '../src/main/transcriptionService';
import { OpenVideoMcpServer } from '../src/main/openVideoMcpServer';
import { settleShortsJob } from '../src/main/shortsAgentTools';
import { measureExportedFile } from '../src/main/exportMeasurement';
import { hashExportOutput } from '../src/main/exportOutputFiles';
import type { ApiResponse } from '../src/shared/models';

const exec = promisify(execFile);
const unwrap = <T>(response: ApiResponse<T>): T => { if (!response.ok) throw new Error(response.error.message); return response.value; };

it.skipIf(process.env.OPENSCENE_VERIFY_SHORTS_EXPORT !== '1')('creates two real portrait MP4s through the registered shorts workflow and reopens them after restart', async () => {
  const runtime = await discoverFfmpeg();
  if (runtime.kind === 'unavailable') throw new Error(runtime.reason);
  const root = await mkdtemp(join(tmpdir(), 'openscene-shorts-e2e-'));
  let service: ShortsService | undefined;
  try {
    const source = join(root, 'source.mp4');
    await exec(runtime.executablePath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', source]);
    const original = await hashExportOutput(source);
    const projects = new ProjectStore(join(root, 'projects'));
    const assets = new AssetLibraryStore(join(root, 'projects'), projects);
    const project = await projects.create({ name: 'Synthetic fixture' });
    const asset = await assets.import({ projectId: project.id, sourcePath: source, displayName: 'Synthetic fixture', kind: 'video', mimeType: 'video/mp4' });
    await assets.updateMetadata({ projectId: project.id, assetId: asset.id, durationMs: 3000, width: 320, height: 180 });
    const cues = [{ id: 'a', text: 'Fixture A', startMs: 200, endMs: 900 }, { id: 'b', text: 'Fixture B', startMs: 1600, endMs: 2400 }];
    await projects.saveAiProjectDocument(project.id, { ...project.ai, transcriptionDraft: { id: 'fixture', sourceAssetId: asset.id, cues, language: 'en', status: 'approved', engine: 'whisper.cpp', modelName: 'fixture', createdAt: new Date().toISOString() } });
    const exportsRoot = join(root, 'exports');
    const exportService = () => new ExportIpcService({ projects, assets, jobs: new ExportJobStore(), exportsRoot, openPath: async () => '' });
    const exports = exportService();
    service = new ShortsService({ projects, assets, exports, transcription: {} as TranscriptionService, jobsDirectory: join(root, 'jobs'),
      measureSource: async () => {
        const measured = await measureExportedFile({ ffmpegPath: runtime.executablePath, filePath: source });
        if (!measured) throw new Error('FFprobe could not measure fixture');
        return { durationMs: measured.durationMs, width: measured.widthPx, height: measured.heightPx };
      },
      // Deterministic evidence selector: this verifies rendering/transport, not model quality or ASR.
      providerFor: () => async () => ({ candidates: cues.map(cue => ({ firstEvidenceId: cue.id, lastEvidenceId: cue.id, reason: cue.text, evidenceIds: [cue.id], context: { completeThought: true, notes: 'Synthetic test evidence' } })) }), pollMs: 10 });
    const server = new OpenVideoMcpServer(); server.setShortsService(service);
    const selected = unwrap(await settleShortsJob(server, await server.startShortsSelection({ projectId: project.id, assetId: asset.id, modelId: 'fixture', requestedCount: 2, minDurationMs: 500, maxDurationMs: 1000 }), undefined, 10));
    expect(selected.stage).toBe('review');
    const created = unwrap(await settleShortsJob(server, await server.createShortsProjects({ jobId: selected.id, candidateIds: selected.selection!.candidates.map(candidate => candidate.id) }), undefined, 10));
    expect(created.items.every(item => item.status === 'ready')).toBe(true);
    const rendered = unwrap(await settleShortsJob(server, await server.exportShortsVideos({ jobId: created.id, resultProjectIds: created.items.map(item => item.resultProjectId!) }), undefined, 10));
    expect(rendered.items.map(item => item.status), JSON.stringify(rendered.items)).toEqual(['completed', 'completed']);
    const restarted = exportService();
    for (const item of rendered.items) {
      const job = unwrap(await restarted.getExportJob({ jobId: item.exportJobId! }));
      expect(job.state.kind).toBe('completed');
      if (job.state.kind !== 'completed') throw new Error('Output is incomplete');
      const path = join(exportsRoot, job.state.fileName);
      expect((await stat(path)).size).toBeGreaterThan(0);
      const measured = await measureExportedFile({ ffmpegPath: runtime.executablePath, filePath: path });
      expect(measured).toMatchObject({ widthPx: 1080, heightPx: 1920, hasSoundTrack: true });
      expect(unwrap(await restarted.openExportResult({ jobId: item.exportJobId! }))).toEqual({ opened: true });
    }
    expect(await hashExportOutput(source)).toEqual(original);
  } finally { await service?.shutdown(); await rm(root, { recursive: true, force: true }); }
}, 60_000);
