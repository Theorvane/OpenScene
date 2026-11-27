import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { runReaProcess } from './reaVideoAnalysisProcess';
import type { ReaAnalysisRuntime } from '../shared/reaVideoAnalysis';

/** Diagnostics only. Never installs packages, imports upstream, or starts its pipeline. */
export async function inspectReaPython(environment: Readonly<Record<string, string | undefined>> = process.env): Promise<NonNullable<ReaAnalysisRuntime['python']>> {
  const configured = environment.VIDEO_TOOL_REA_PYTHON_PATH?.trim();
  const candidates = configured ? [configured] : (environment.PATH ?? '').split(delimiter).filter(isAbsolute).flatMap(directory => [join(directory, process.platform === 'win32' ? 'python.exe' : 'python3')]);
  for (const path of candidates) {
    try {
      if (!isAbsolute(path) || path.includes('\0')) continue;
      const executable = await realpath(path);
      if (!(await stat(executable)).isFile()) continue;
      await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      const output = await runReaProcess(executable, ['--version'], new AbortController().signal, 2000);
      const match = /Python (\d+)\.(\d+)\.(\d+)/.exec(output.stdout + output.stderr);
      if (match && (Number(match[1]) > 3 || (Number(match[1]) === 3 && Number(match[2]) >= 10))) return { status: 'compatible', version: `${match[1]}.${match[2]}.${match[3]}` };
    } catch { /* Diagnostic absence is not an installation request. */ }
  }
  return { status: 'unavailable' };
}
