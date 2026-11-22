import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

export type FfmpegDiscoveryResult =
  | { readonly kind: 'configured'; readonly executablePath: string }
  | { readonly kind: 'system'; readonly executablePath: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type FfmpegDiscoveryOptions = {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
};

function executableNames(platform: NodeJS.Platform, environment: Readonly<Record<string, string | undefined>>): readonly string[] {
  if (platform !== 'win32') {
    return ['ffmpeg'];
  }
  const extensions = (environment.PATHEXT ?? '.EXE').split(';').filter((extension) => extension.length > 0);
  return extensions.map((extension) => `ffmpeg${extension.toLowerCase()}`);
}

async function resolveExecutable(path: string, platform: NodeJS.Platform): Promise<string | null> {
  try {
    const resolved = await realpath(path);
    const fileStats = await stat(resolved);
    if (!fileStats.isFile()) {
      return null;
    }
    await access(resolved, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return resolved;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error) {
      return null;
    }
    throw error;
  }
}

export async function discoverFfmpeg(options: FfmpegDiscoveryOptions = {}): Promise<FfmpegDiscoveryResult> {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const configuredPath = environment.VIDEO_TOOL_FFMPEG_PATH?.trim();
  if (configuredPath !== undefined && configuredPath.length > 0) {
    if (!isAbsolute(configuredPath) || configuredPath.includes('\0')) {
      return { kind: 'unavailable', reason: 'Configured FFmpeg path must be absolute.' };
    }
    const executablePath = await resolveExecutable(configuredPath, platform);
    return executablePath === null
      ? { kind: 'unavailable', reason: 'Configured FFmpeg executable is not available.' }
      : { kind: 'configured', executablePath };
  }

  const pathDirectories = (environment.PATH ?? '').split(delimiter).filter((directory) => isAbsolute(directory));
  for (const directory of pathDirectories) {
    for (const name of executableNames(platform, environment)) {
      const executablePath = await resolveExecutable(join(directory, name), platform);
      if (executablePath !== null) {
        return { kind: 'system', executablePath };
      }
    }
  }

  // The installer can launch OpenScene before Windows refreshes its inherited PATH.
  const localAppData = environment.LOCALAPPDATA;
  if (platform === 'win32' && localAppData && isAbsolute(localAppData)) {
    const executablePath = await resolveExecutable(
      join(localAppData, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
      platform
    );
    if (executablePath !== null) {
      return { kind: 'system', executablePath };
    }
  }
  return { kind: 'unavailable', reason: 'FFmpeg was not configured and was not found on the system PATH.' };
}
