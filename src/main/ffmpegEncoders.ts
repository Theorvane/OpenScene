import { spawn } from 'node:child_process';

/** Bounded preparation subprocess; successful spawn settles only after process exit. */
export function runFfmpegPreparationProbe(executablePath: string, args: readonly string[], timeoutMs = 5000): Promise<{ stdout: string; exitCode: number | null }> {
  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(executablePath, [...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { resolve({ stdout: '', exitCode: null }); return; }
    let listing = '';
    let stopped = false;
    const stop = () => { stopped = true; child.kill('SIGKILL'); };
    const timer = setTimeout(stop, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (listing.length + chunk.byteLength > 1024 * 1024) stop();
      else listing += chunk.toString();
    });
    child.once('error', () => { clearTimeout(timer); resolve({ stdout: '', exitCode: null }); });
    child.once('close', code => { clearTimeout(timer); resolve({ stdout: stopped ? '' : listing, exitCode: stopped ? null : code }); });
  });
}

export async function inspectFfmpegEncoders(executablePath: string): Promise<string> {
  const result = await runFfmpegPreparationProbe(executablePath, ['-hide_banner', '-encoders']);
  return result.exitCode === 0 ? result.stdout : '';
}
