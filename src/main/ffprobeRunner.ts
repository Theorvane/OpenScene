import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, realpath, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

export type FfprobeRuntime = 'native' | 'linux-container';
type CommandResult = { readonly kind: 'success'; readonly stdout: string } | { readonly kind: 'unavailable' | 'failed' };
type CommandOptions = { readonly timeoutMs: number; readonly onAbort?: () => Promise<void> };
type Execute = (executable: string, args: readonly string[], options: CommandOptions) => Promise<CommandResult>;
type ProbeInput = { readonly executablePath: string; readonly filePath: string; readonly args: readonly string[] };
type ProbeOptions = {
  readonly platform?: NodeJS.Platform;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly execute?: Execute;
  readonly resolveDocker?: () => Promise<string | null>;
  readonly resolveInput?: (filePath: string) => Promise<string | null>;
};
export type FfprobeResult = { readonly stdout: string; readonly runtime: FfprobeRuntime };

const OUTPUT_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_LINUX_IMAGE = 'openscene-media-analysis:local';

/** Bounded output and deadline for both the native probe and the local Docker client. */
const execute: Execute = (executable, args, options) => new Promise(resolve => {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let child: ReturnType<typeof spawn>;
  const finish = (result: CommandResult, aborted = false) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (aborted && options.onAbort) {
      void options.onAbort().catch(() => undefined).finally(() => resolve(result));
    } else resolve(result);
  };
  try {
    child = spawn(executable, [...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { finish({ kind: 'unavailable' }); return; }
  if (child.stdout === null) { child.kill(); finish({ kind: 'failed' }, true); return; }
  const chunks: Buffer[] = [];
  let bytes = 0;
  child.stdout.on('data', (chunk: Buffer) => {
    if (settled) return;
    bytes += chunk.byteLength;
    if (bytes > OUTPUT_LIMIT_BYTES) { child.kill(); finish({ kind: 'failed' }, true); return; }
    chunks.push(chunk);
  });
  timer = setTimeout(() => { child.kill(); finish({ kind: 'failed' }, true); }, options.timeoutMs);
  child.once('error', () => finish({ kind: 'unavailable' }));
  child.once('close', code => finish(code === 0 ? { kind: 'success', stdout: Buffer.concat(chunks).toString('utf8') } : { kind: 'failed' }));
});

async function regularFile(filePath: string): Promise<string | null> {
  if (!isAbsolute(filePath) || filePath.includes('\0')) return null;
  try {
    const resolved = await realpath(filePath);
    return (await stat(resolved)).isFile() ? resolved : null;
  } catch { return null; }
}

async function dockerExecutable(environment: Readonly<Record<string, string | undefined>>): Promise<string | null> {
  const override = environment.VIDEO_TOOL_FFPROBE_DOCKER_PATH?.trim();
  const candidates = override ? [override] : [
    ...(environment.PATH ?? environment.Path ?? '').split(delimiter).filter(isAbsolute).map(directory => join(directory, 'docker.exe')),
    ...(environment.LOCALAPPDATA ? [join(environment.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe')] : []),
    ...(environment.ProgramFiles ? [join(environment.ProgramFiles, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe')] : [])
  ];
  for (const candidate of candidates) {
    const resolved = await regularFile(candidate);
    if (resolved === null) continue;
    try { await access(resolved); return resolved; } catch { /* Try the next installed client. */ }
  }
  return null;
}

/** Only the one input file is mounted; commas in names are escaped as Docker CSV fields. */
export function linuxFfprobeArgs(image: string, filePath: string, args: readonly string[], containerName: string): readonly string[] {
  const source = 'source=' + filePath;
  const escaped = /[",\r\n]/.test(source) ? '"' + source.replaceAll('"', '""') + '"' : source;
  return ['run', '--rm', '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--name', containerName,
    '--mount', 'type=bind,' + escaped + ',target=/media/input,readonly',
    '--entrypoint', '/usr/bin/ffprobe', image, ...args.slice(0, -1), '/media/input'];
}

/** Windows can use the already-prepared Linux toolchain when the native executable cannot start. */
export async function runFfprobe(input: ProbeInput, options: ProbeOptions = {}): Promise<FfprobeResult | null> {
  if (input.args.at(-1) !== input.filePath) return null;
  const run = options.execute ?? execute;
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const native = platform === 'win32' && environment.VIDEO_TOOL_FFPROBE_RUNTIME === 'linux-container'
    ? { kind: 'unavailable' as const }
    : await run(input.executablePath, input.args, { timeoutMs: 15_000 });
  if (native.kind === 'success') return { stdout: native.stdout, runtime: 'native' };
  if (native.kind !== 'unavailable' || platform !== 'win32') return null;
  if (environment.VIDEO_TOOL_FFPROBE_LINUX_FALLBACK === 'false') return null;
  const image = environment.VIDEO_TOOL_FFPROBE_LINUX_IMAGE?.trim() || DEFAULT_LINUX_IMAGE;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/.test(image)) return null;
  const filePath = await (options.resolveInput ?? regularFile)(input.filePath);
  if (filePath === null) return null;
  const docker = await (options.resolveDocker ?? (() => dockerExecutable(environment)))();
  if (docker === null) return null;
  const name = 'openscene-ffprobe-' + randomUUID();
  const result = await run(docker, linuxFfprobeArgs(image, filePath, input.args, name), {
    timeoutMs: 30_000,
    onAbort: async () => { await run(docker, ['rm', '--force', name], { timeoutMs: 5_000 }); }
  });
  return result.kind === 'success' ? { stdout: result.stdout, runtime: 'linux-container' } : null;
}
