import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { downloadGenerationResult, publicGenerationAddress, type GenerationDownloadTransport } from '../src/main/reaGenerationDownload';
import { ReaGenerationResultService } from '../src/main/reaGenerationResultService';
import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';
import { runReaProcess } from '../src/main/reaVideoAnalysisProcess';
import { ProjectStore } from '../src/main/projectStore';
import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { generationPlanHash } from '../src/main/reaGenerationPlan';
import type { ReaGenerationPlan } from '../src/shared/reaGeneration';
import { MinimaxVideoAdapter } from '../src/main/minimaxVideoAdapter';
import { ReaGenerationJobStore } from '../src/main/reaGenerationJobStore';
import { OfflineReaGenerationRunner } from '../src/main/reaGenerationRunner';
import { applyVerifiedGenerationImport } from '../src/shared/reaGenerationImport';
import { resolveGenerationReference } from '../src/main/reaGenerationReference';
vi.mock('node:https', () => ({ request: vi.fn(() => { throw new Error('EXTERNAL_NETWORK_FORBIDDEN'); }) }));

const directories: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function directory() { const d = await mkdtemp(join(tmpdir(), 'rea-results-')); directories.push(d); return d; }
const url = 'https://cdn.hailuoai.com/private/result.mp4?signature=never-render';
function fixture(bytes: Uint8Array): GenerationDownloadTransport {
  return { resolve: vi.fn(async () => ['93.184.216.34']), open: vi.fn(async () => ({ status: 200, mimeType: 'video/mp4', contentLength: bytes.byteLength,
    remoteAddress: '93.184.216.34', body: (async function* () { yield bytes; })(), close: vi.fn() })) };
}
describe('main-only generation result pipeline', () => {
  it.each(['http://cdn.hailuoai.com/x', 'https://evil.example/x', 'https://api.minimax.io/x', 'https://cdn.hailuoai.com.evil.test/x', 'https://user:password@cdn.hailuoai.com/x', 'https://cdn.hailuoai.com:444/x', 'https://127.0.0.1/x'])('rejects unapproved URL %s before transport', async bad => {
    const d = await directory(), t = fixture(Buffer.from('x'));
    await expect(downloadGenerationResult(bad, join(d, 'out.mp4'), new AbortController().signal, t)).rejects.toThrow('RESULT_DOWNLOAD_REJECTED');
    expect(t.open).not.toHaveBeenCalled(); expect(await readdir(d)).toEqual([]);
  });
  it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1'])('rejects private/reserved DNS %s', async address => {
    expect(publicGenerationAddress(address)).toBe(false); const d = await directory(), t = fixture(Buffer.from('x'));
    t.resolve = async () => ['93.184.216.34', address];
    await expect(downloadGenerationResult(url, join(d, 'out.mp4'), new AbortController().signal, t)).rejects.toThrow(); expect(t.open).not.toHaveBeenCalled();
  });
  it.each(['redirect', 'rebinding', 'wrong-mime', 'oversize', 'truncated', 'stream-error'])('cleans up %s and hides URL/path', async failure => {
    const d = await directory(), t = fixture(Buffer.from('small-payload')), original = t.open;
    t.open = async (...args) => {
      const r = await original(...args);
      if (failure === 'redirect') return { ...r, status: 302 };
      if (failure === 'rebinding') return { ...r, remoteAddress: '127.0.0.1' };
      if (failure === 'wrong-mime') return { ...r, mimeType: 'text/html' };
      if (failure === 'oversize') return { ...r, contentLength: 100_000_001 };
      if (failure === 'truncated') return { ...r, contentLength: 100 };
      return { ...r, body: (async function* () { yield Buffer.from('partial'); throw new Error(url); })() };
    };
    await expect(downloadGenerationResult(url, join(d, 'out.mp4'), new AbortController().signal, t)).rejects.toThrow('RESULT_DOWNLOAD_REJECTED');
    expect(await readdir(d)).toEqual([]);
  });
  it('aborts a stalled stream and deletes its partial file', async () => {
    const d = await directory(), t = fixture(Buffer.from('first')), controller = new AbortController(), opened = t.open;
    t.open = async (...args) => ({ ...await opened(...args), contentLength: null, body: (async function* () { yield Buffer.from('partial'); controller.abort(); await new Promise(() => {}); })() });
    await expect(downloadGenerationResult(url, join(d, 'out.mp4'), controller.signal, t)).rejects.toThrow(); expect(await readdir(d)).toEqual([]);
  });
  it('verifies real local MP4, registers generated provenance, trims/fits assembly and preserves original bytes', async ctx => {
    const tools = await discoverFfmpeg(); if (tools.kind === 'unavailable') { ctx.skip(); return; }
    const d = await directory(), signal = new AbortController().signal, source = join(d, 'testsrc.mp4');
    // Explicitly authorized synthetic fixture: no models or source media leave this machine.
    await runReaProcess(tools.executablePath, ['-nostdin', '-hide_banner', '-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=1366x768:rate=12', '-t', '4', '-an', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source], signal, 30000);
    const bytes = await readFile(source), projectsPath = join(d, 'projects'), projects = new ProjectStore(projectsPath), project = await projects.create({ name: 'Offline generated fixture' });
    const assets = new AssetLibraryStore(projectsPath, projects), sourceAsset = await assets.import({ projectId: project.id, sourcePath: source, displayName: 'Original.mp4', kind: 'video', mimeType: 'video/mp4' });
    const p: ReaGenerationPlan = { version: 1, projectId: project.id, sourceAssetId: sourceAsset.id, sourceEpoch: 'epoch', reviewVersion: 1, shotId: 'shot', sourceStartMs: 0, sourceEndMs: 4000, prompt: 'Synthetic fixture',
      provider: 'minimax-video-payg', baseUrl: 'https://api.minimax.io', model: 'MiniMax-H3', resolution: '768P', generateAudio: false, durationSeconds: 4, ratio: '16:9', referenceImage: null,
      estimate: { currency: 'USD', outputMicroUsdPerSecond: 80000, totalMicroUsd: 320000, budgetMicroUsd: 320000, pricedAt: '2026-11-27', billingCapGuaranteed: false }, manifest: { prompt: true, firstFrame: false, sourceVideo: false, sourceAudio: false } };
    const service = new ReaGenerationResultService(join(d, 'private'), async () => tools.executablePath, assets, fixture(bytes));
    const protocol = vi.fn(async (r: { method: string }) => ({ status: 200, body: r.method === 'POST' ? '{"task_id":"fixture-task"}' : JSON.stringify({ task: { id: 'fixture-task', model: 'MiniMax-H3', status: 'succeeded', task_type: 'generation', modality: 'video', resolution: '768P', duration: 4, content: { url } } }) }));
    const adapter = new MinimaxVideoAdapter({ kind: 'offline-fixture', request: protocol });
    const jobs = new ReaGenerationJobStore(join(d, 'jobs'), adapter), runner = new OfflineReaGenerationRunner(jobs, adapter, service);
    const prepared = await jobs.prepare(p); await runner.submit(prepared.receipt.id, prepared.approval, p);
    const observed = await runner.observe(prepared.receipt.id, project.id), receipt = observed.receipt, result = observed.result!;
    expect(protocol.mock.calls.filter(([r]) => r.method === 'POST')).toHaveLength(1);
    expect(receipt).toMatchObject({ state: 'remote-succeeded', assetVerified: false });
    expect(result.asset.resultOrigin).toEqual({ kind: 'ai-generation', resultId: receipt.id }); expect(result.durationMs).toBe(4000); expect(result.label).toBe('generated');
    expect(JSON.stringify(result)).not.toContain('signature'); expect(JSON.stringify(result)).not.toContain(d);
    expect(await readdir(join(d, 'private'))).toEqual([]);
    const assembly = await service.assemble(receipt.id, project.id, 'epoch', 2000, signal);
    expect(assembly).toMatchObject({ durationMs: 2000, label: 'local-render', asset: { metadata: { width: 1366, height: 768 } } });
    if (process.env.REA_GENERATION_REVIEW_ARTIFACT_DIR) {
      const artifact = process.env.REA_GENERATION_REVIEW_ARTIFACT_DIR; await mkdir(artifact, { recursive: true });
      await copyFile(source, join(artifact, 'source-testsrc.mp4'));
      await copyFile((await assets.getPlaybackSource(project.id, assembly.asset.id))!.filePath, join(artifact, 'local-assembly-review.mp4'));
    }
    const imagePath = join(d, 'frame.png');
    await runReaProcess(tools.executablePath, ['-nostdin', '-hide_banner', '-v', 'error', '-n', '-protocol_whitelist', 'file', '-i', source, '-frames:v', '1', '-threads', '1', imagePath], signal, 15000);
    const imageAsset = await assets.import({ projectId: project.id, sourcePath: imagePath, displayName: 'First frame.png', kind: 'image', mimeType: 'image/png' });
    const reference = await resolveGenerationReference(assets, join(d, 'reference'), tools.executablePath, project.id, imageAsset.id);
    const imagePlan: ReaGenerationPlan = { ...p, ratio: 'adaptive', referenceImage: reference.reference, manifest: { ...p.manifest, firstFrame: true } };
    const imageApproval = await jobs.prepare(imagePlan);
    await runner.submit(imageApproval.receipt.id, imageApproval.approval, imagePlan, reference.bytes);
    const lastPost = protocol.mock.calls.filter(([r]) => r.method === 'POST').at(-1)![0] as { method: string; body: string };
    expect(JSON.parse(lastPost.body).content[1]).toMatchObject({ type: 'image_url', role: 'first_frame' });
    expect(await readdir(join(d, 'reference'))).toEqual([]);
    expect(await readFile(source)).toEqual(bytes); expect((await projects.open(project.id))!.timeline).toEqual(project.timeline);
    const target = project.timeline.tracks.find(t => t.kind === 'video')!;
    const scope = { jobId: receipt.id, projectId: project.id, sourceEpoch: 'epoch', trackId: target.id, atMs: 0 };
    await expect(service.prepareImport(scope, async () => false)).rejects.toThrow();
    const handoff = await service.prepareImport(scope, async () => true), reopened = (await projects.open(project.id))!;
    const imported = applyVerifiedGenerationImport(reopened, handoff)!;
    expect(imported.timeline.tracks.find(t => t.id === target.id)!.clips).toHaveLength(1);
    expect(reopened.timeline).toEqual(project.timeline);
    expect(service.get(receipt.id, 'foreign', 'epoch')).toBeNull(); expect(service.get(receipt.id, project.id, 'changed')).toBeNull();
    service.retire(receipt.id); expect(service.get(receipt.id, project.id, 'epoch')).toBeNull();
    await expect(service.assemble(receipt.id, project.id, 'epoch', 2000, signal)).rejects.toThrow();
    const invalid = new ReaGenerationResultService(join(d, 'invalid'), async () => tools.executablePath, assets, fixture(Buffer.from('not a video')));
    await expect(invalid.receive({ ...receipt, id: randomUUID() }, p, url, signal)).rejects.toThrow('RESULT_VERIFICATION_UNAVAILABLE'); expect(await readdir(join(d, 'invalid'))).toEqual([]);
    const truncated = new ReaGenerationResultService(join(d, 'truncated'), async () => tools.executablePath, assets, fixture(bytes.subarray(0, Math.floor(bytes.length / 2))));
    await expect(truncated.receive({ ...receipt, id: randomUUID() }, p, url, signal)).rejects.toThrow();
    expect(await readdir(join(d, 'truncated'))).toEqual([]);
    const lateId = randomUUID(), lateTransport = fixture(bytes), lateOpen = lateTransport.open;
    const late = new ReaGenerationResultService(join(d, 'late'), async () => tools.executablePath, assets, lateTransport);
    lateTransport.open = async (...args) => ({ ...await lateOpen(...args), body: (async function* () { late.retire(lateId); yield bytes; })() });
    const count = (await projects.open(project.id))!.assets.length;
    await expect(late.receive({ ...receipt, id: lateId }, p, url, signal)).rejects.toThrow();
    expect(late.get(lateId, project.id, 'epoch')).toBeNull(); expect((await projects.open(project.id))!.assets).toHaveLength(count);
    expect(await readdir(join(d, 'late'))).toEqual([]);
  }, 60000);
});
