import { spawn } from 'node:child_process';
import { REA_ANALYSIS_LIMITS } from '../shared/reaVideoAnalysis';

export class ReaProcessError extends Error {
  constructor(readonly kind: 'runtime-unavailable' | 'invalid-media' | 'resource-limit' | 'cancelled') { super(kind); }
}
/** No shell, no stdin, bounded buffers/time, no child diagnostics exposed across IPC. */
export function runReaProcess(executable: string, args: readonly string[], signal: AbortSignal, timeoutMs: number = REA_ANALYSIS_LIMITS.timeoutMs): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new ReaProcessError('cancelled')); return; }
    const child = spawn(executable, [...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0;
    let failure: ReaProcessError | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (kind: ReaProcessError['kind']) => {
      if (failure) return;
      failure = new ReaProcessError(kind);
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
    };
    const abort = () => stop('cancelled');
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => stop('resource-limit'), timeoutMs);
    const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      bytes += chunk.length;
      if (bytes > REA_ANALYSIS_LIMITS.outputBytes) { stop('resource-limit'); return; }
      if (stream === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));
    child.once('error', () => { failure ??= new ReaProcessError('runtime-unavailable'); });
    child.once('close', code => {
      clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
      signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new ReaProcessError('invalid-media'));
      else resolve({ stdout, stderr });
    });
  });
}
