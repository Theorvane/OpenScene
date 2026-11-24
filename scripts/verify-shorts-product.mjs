// Opt-in integration: requires the actual Backend/LLM runtime, not just shared types.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, run } from './shorts-media.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedTest = join(root, 'tests', 'shortsProductMedia.generated.test.ts');
let createdTest = false;
try {
  if (!existsSync(join(root, 'src/main/shortsService.ts'))) throw new Error('Product runtime is absent. Apply the Backend/LLM runtime in an isolated checkout before running this opt-in verification. This is not a product success.');
  const ffmpeg = process.env.VIDEO_TOOL_FFMPEG_PATH;
  const ffprobe = process.env.FFPROBE_PATH;
  if (!ffmpeg || !ffprobe || !isAbsolute(ffmpeg) || !isAbsolute(ffprobe) || process.env.FFMPEG_PATH !== ffmpeg) {
    throw new Error('Set matching absolute VIDEO_TOOL_FFMPEG_PATH, FFMPEG_PATH and FFPROBE_PATH; use a drawtext/libx264/AAC-capable FFmpeg build.');
  }
  if (existsSync(generatedTest)) throw new Error(`Refusing to replace ${generatedTest}`);
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (git.status !== 0) throw new Error('Cannot identify the tested Git SHA');
  const runtimeSha = git.stdout.trim();
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' });
  if (status.status !== 0 || status.stdout.trim()) throw new Error('Tracked checkout changes prevent exact-SHA product verification; commit or preserve them first.');
  const artifacts = mkdtempSync(join(tmpdir(), 'openscene-shorts-verification-'));
  const fixtures = join(artifacts, 'fixtures');
  const pointer = join(artifacts, 'evidence-root.txt');
  console.log(`Runtime SHA: ${runtimeSha}\nHarness artifacts: ${artifacts}`);
  // Probe both tools before the service's bounded probes; generation also calibrates source characteristics.
  run(ffmpeg, ['-version']);
  run(ffprobe, ['-version']);
  generate(fixtures);
  const harnessHashes = Object.fromEntries(['shorts-media.mjs', 'verify-shorts-product.mjs', 'shorts-product.integration.ts.template'].map(name => [name, createHash('sha256').update(readFileSync(join(root, 'scripts', name))).digest('hex')]));
  writeFileSync(join(artifacts, 'execution.json'), JSON.stringify({ runtimeSha, harnessHashes, ffmpeg, ffprobe, scope: 'Real product services and media; declared transcript/provider response, no model inference or ASR', unsupportedFfmpegCheck: Boolean(process.env.OPENSCENE_SHORTS_UNSUPPORTED_FFMPEG) }, null, 2));
  writeFileSync(generatedTest, readFileSync(join(root, 'scripts/shorts-product.integration.ts.template')), { flag: 'wx' });
  createdTest = true;
  const result = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', generatedTest], {
    cwd: root, stdio: 'inherit', timeout: 240_000, detached: process.platform !== 'win32',
    env: { ...process.env, OPENSCENE_SHORTS_FIXTURES: fixtures, OPENSCENE_SHORTS_EVIDENCE_POINTER: pointer, OPENSCENE_SHORTS_TESTED_SHA: runtimeSha }
  });
  if (existsSync(pointer)) console.log(`Product evidence: ${readFileSync(pointer, 'utf8')}`);
  if (result.error || result.status !== 0) {
    if (process.platform !== 'win32' && result.pid) {
      try { process.kill(-result.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    throw new Error(`Product integration failed: ${result.error?.message || `exit ${result.status}, signal ${result.signal}`}; preserve ${artifacts} for diagnosis. Cleanup is not verified after a failed run.`);
  }
  console.log(`Product service/media checks passed at ${runtimeSha}. Real model inference and ASR remain unverified.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (createdTest) unlinkSync(generatedTest);
}
