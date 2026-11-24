// Standalone infrastructure checks. This does not call or emulate the product batch API.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const captions = '1\n00:00:01,000 --> 00:00:02,500\nOpenScene fixture A\n\n2\n00:00:05,000 --> 00:00:07,000\nOpenScene fixture B\n';
export const profiles = { smoke: [360, 640], product: [1080, 1920], source: [640, 360] };
export function run(binary, args, binaryOutput = false) {
  const result = spawnSync(binary, args, { encoding: binaryOutput ? undefined : 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${binary} failed: ${result.error?.message || result.stderr?.toString().slice(-4000)}`);
  return result.stdout;
}
function encode(args) { return run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args]); }
function probe(file) { return JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])); }
function requireCheck(condition, message) { if (!condition) throw new Error(message); }
export function verifySrt(file, startSeconds, endSeconds) {
  requireCheck(Number.isFinite(startSeconds) && Number.isFinite(endSeconds) && startSeconds >= 0 && endSeconds > startSeconds && endSeconds <= 12, 'Expected a source range within the 12-second fixture');
  const parse = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim().split(/\n\s*\n/).filter(Boolean).map(block => {
    const lines = block.split('\n');
    requireCheck(/^\d+$/.test(lines[0]), 'Invalid SRT cue index');
    const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(lines[1]);
    requireCheck(match, 'Invalid SRT timing');
    const clock = offset => Number(match[offset]) * 3600 + Number(match[offset + 1]) * 60 + Number(match[offset + 2]) + Number(match[offset + 3]) / 1000;
    return { start: clock(1), end: clock(5), text: lines.slice(2).join('\n') };
  });
  const expected = parse(captions).filter(c => c.start < endSeconds && c.end > startSeconds).map(c => ({ ...c, start: Math.max(c.start, startSeconds) - startSeconds, end: Math.min(c.end, endSeconds) - startSeconds }));
  const actual = parse(readFileSync(file, 'utf8'));
  requireCheck(actual.length === expected.length, 'Subtitle cue count mismatch');
  actual.forEach((cue, index) => {
    const wanted = expected[index];
    requireCheck(cue.text === wanted.text && Math.abs(cue.start - wanted.start) < 0.001 && Math.abs(cue.end - wanted.end) < 0.001, `Subtitle cue ${index + 1} content/timing mismatch`);
    requireCheck(cue.start >= 0 && cue.end > cue.start && cue.end <= endSeconds - startSeconds && (index === 0 || cue.start >= actual[index - 1].end), 'Subtitle interval invalid');
  });
  return { file, cueCount: actual.length, sourceRange: [startSeconds, endSeconds] };
}
export function verify(file, profile, seconds, audio) {
  requireCheck(profiles[profile] && Number.isFinite(seconds) && seconds > 0, 'Specify a known profile and positive duration');
  requireCheck(['tone', 'silent', 'absent'].includes(audio), 'Audio must be tone, silent or absent');
  const metadata = probe(file);
  requireCheck(metadata.format.format_name.split(',').includes('mp4'), 'Expected MP4 container');
  const videos = metadata.streams.filter(s => s.codec_type === 'video');
  const audios = metadata.streams.filter(s => s.codec_type === 'audio');
  requireCheck(videos.length === 1, 'Expected exactly one video stream');
  const video = videos[0];
  const [width, height] = profiles[profile];
  const [num, den] = video.avg_frame_rate.split('/').map(Number);
  const fps = num / den;
  requireCheck(video.width === width && video.height === height, `Expected ${width}x${height}`);
  requireCheck(video.codec_name === 'h264' && video.pix_fmt === 'yuv420p', 'Expected H264/yuv420p');
  requireCheck(Math.abs(fps - 30) < 0.001, 'Expected 30 fps');
  requireCheck(video.sample_aspect_ratio === '1:1', 'Expected square pixels');
  requireCheck(!(video.side_data_list ?? []).some(s => s.rotation && s.rotation % 360 !== 0), 'Unexpected rotation metadata');
  const tolerance = Math.max(0.1, 2 / fps);
  for (const [label, duration] of [['container', metadata.format.duration], ['video', video.duration], ...audios.map(a => ['audio', a.duration])]) {
    requireCheck(Number.isFinite(Number(duration)) && Math.abs(Number(duration) - seconds) <= tolerance, `${label} duration outside ${tolerance}s tolerance`);
  }
  requireCheck(audios.length === (audio === 'absent' ? 0 : 1), 'Unexpected audio stream count');
  let rms = null;
  if (audios.length) {
    requireCheck(audios[0].codec_name === 'aac', 'Expected AAC');
    const pcm = run(ffmpeg, ['-v', 'error', '-nostdin', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], true);
    let squares = 0;
    requireCheck(pcm.length > 0, 'No decoded audio samples');
    for (let offset = 0; offset < pcm.length; offset += 4) squares += pcm.readFloatLE(offset) ** 2;
    rms = Math.sqrt(squares / (pcm.length / 4));
    requireCheck(Number.isFinite(rms) && (audio === 'tone' ? rms >= 0.01 : rms <= 0.0001), `Unexpected ${audio} RMS ${rms}`);
  }
  // Decode all video frames as well as reading container metadata.
  encode(['-xerror', '-i', file, '-map', '0:v:0', '-f', 'null', '-']);
  return { file, profile, seconds: Number(metadata.format.duration), fps, width, height, audio, rms, toleranceSeconds: tolerance };
}
export function generate(directory) {
  // Refuse replacement: source fixtures are immutable per run.
  requireCheck(!existsSync(directory), 'Destination already exists; choose a fresh directory');
  mkdirSync(directory, { recursive: true });
  const evidence = [];
  for (const audio of ['tone', 'silent', 'absent']) {
    const file = join(directory, `${audio}.mp4`);
    const input = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=12'];
    if (audio !== 'absent') input.push('-f', 'lavfi', '-i', audio === 'tone' ? 'sine=frequency=440:sample_rate=48000:duration=12' : 'anullsrc=r=48000:cl=mono');
    encode([...input, '-t', '12', '-map', '0:v:0', ...(audio === 'absent' ? ['-an'] : ['-map', '1:a:0', '-c:a', 'aac']), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-vf', 'setsar=1', '-movflags', '+faststart', '-n', file]);
    evidence.push(verify(file, 'source', 12, audio));
  }
  writeFileSync(join(directory, 'captions.srt'), captions);
  writeFileSync(join(directory, 'fixture-evidence.json'), JSON.stringify({ ffmpeg: run(ffmpeg, ['-version']).split('\n')[0], evidence }, null, 2));
  return evidence;
}
export function selfTest(directory, profile) {
  requireCheck(['smoke', 'product'].includes(profile), 'Self-test profile must be smoke or product');
  generate(directory);
  const [width, height] = profiles[profile];
  const evidence = [];
  for (const audio of ['tone', 'silent', 'absent']) {
    const file = join(directory, `${audio}-${profile}.mp4`);
    encode(['-i', join(directory, `${audio}.mp4`), '-ss', '2', '-t', '3', '-map', '0:v:0', '-map', '0:a?', '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-n', file]);
    evidence.push(verify(file, profile, 3, audio));
  }
  // These deliberately wrong expectations must be rejected by the checker.
  for (const [duration, audio] of [[4, 'tone'], [3, 'silent'], [3, 'absent']]) {
    let rejected = false;
    try { verify(join(directory, `tone-${profile}.mp4`), profile, duration, audio); } catch { rejected = true; }
    requireCheck(rejected, 'Checker accepted a deliberately incorrect expectation');
  }
  requireCheck(readFileSync(join(directory, 'captions.srt'), 'utf8') === captions, 'Fixture subtitle mismatch');
  verifySrt(join(directory, 'captions.srt'), 0, 12);
  writeFileSync(join(directory, 'rebased.srt'), '1\n00:00:00,000 --> 00:00:00,500\nOpenScene fixture A\n');
  verifySrt(join(directory, 'rebased.srt'), 2, 5);
  let rejectedSrt = false;
  try { verifySrt(join(directory, 'captions.srt'), 2, 5); } catch { rejectedSrt = true; }
  requireCheck(rejectedSrt, 'Checker accepted untrimmed subtitles for a trimmed output');
  writeFileSync(join(directory, `self-test-${profile}.json`), JSON.stringify({ scope: 'Harness calibration only; not a product export', evidence }, null, 2));
  return evidence;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, target, profile, seconds, audio] = process.argv.slice(2);
    requireCheck(target, 'Usage: node scripts/shorts-media.mjs generate DIR | self-test DIR smoke|product | verify FILE PROFILE SECONDS tone|silent|absent | verify-srt FILE SOURCE_START_SECONDS SOURCE_END_SECONDS');
    const result = command === 'generate' ? generate(resolve(target)) : command === 'self-test' ? selfTest(resolve(target), profile) : command === 'verify' ? verify(resolve(target), profile, Number(seconds), audio) : command === 'verify-srt' ? verifySrt(resolve(target), Number(profile), Number(seconds)) : null;
    requireCheck(result, 'Unknown command');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
