import { describe, expect, it, vi } from 'vitest';
import { linuxFfprobeArgs, runFfprobe } from '../src/main/ffprobeRunner';

const input = { executablePath: 'C:\\tools\\ffprobe.exe', filePath: 'C:\\exports\\a,b.mp4', args: ['-v', 'error', '-of', 'json', 'C:\\exports\\a,b.mp4'] };
const options = {
  platform: 'win32' as const,
  environment: {},
  resolveDocker: async () => 'C:\\docker.exe',
  resolveInput: async () => input.filePath
};

describe('local Linux FFprobe fallback', () => {
  it('keeps native success and never starts Docker', async () => {
    const execute = vi.fn().mockResolvedValue({ kind: 'success', stdout: '{}' });
    expect(await runFfprobe(input, { ...options, execute })).toEqual({ stdout: '{}', runtime: 'native' });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('can select Linux directly on Windows without attempting the native probe', async () => {
    const execute = vi.fn().mockResolvedValue({ kind: 'success', stdout: '{}' });
    expect(await runFfprobe(input, { ...options, environment: { VIDEO_TOOL_FFPROBE_RUNTIME: 'linux-container' }, execute })).toEqual({ stdout: '{}', runtime: 'linux-container' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toBe('C:\\docker.exe');
  });
  it('uses the prepared Linux image when Windows cannot start FFprobe', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ kind: 'unavailable' }).mockResolvedValueOnce({ kind: 'success', stdout: '{"streams":[]}' });
    expect(await runFfprobe(input, { ...options, execute })).toEqual({ stdout: '{"streams":[]}', runtime: 'linux-container' });
    const args = execute.mock.calls[1]![1] as string[];
    expect(args).toContain('--network=none');
    expect(args).toContain('--pull=never');
    expect(args).toContain('--read-only');
    expect(args).toContain('type=bind,"source=C:\\exports\\a,b.mp4",target=/media/input,readonly');
    expect(args.at(-1)).toBe('/media/input');
    const opts = execute.mock.calls[1]![2] as { timeoutMs: number; onAbort: () => Promise<void> };
    expect(opts.timeoutMs).toBe(30_000);
    await opts.onAbort();
    expect(execute.mock.calls[2]![1]).toEqual(['rm', '--force', args[args.indexOf('--name') + 1]]);
  });
  it.each(['failed', 'success'] as const)('does not retry a native %s result in another environment', async kind => {
    const execute = vi.fn().mockResolvedValue({ kind, stdout: '{}' });
    await runFfprobe(input, { ...options, execute });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it.each([
    { platform: 'linux' as const },
    { environment: { VIDEO_TOOL_FFPROBE_LINUX_FALLBACK: 'false' } },
    { environment: { VIDEO_TOOL_FFPROBE_LINUX_IMAGE: '--privileged' } },
    { resolveDocker: async () => null },
    { resolveInput: async () => null }
  ])('leaves missing or disabled verification unchecked', async overrides => {
    const execute = vi.fn().mockResolvedValue({ kind: 'unavailable' });
    expect(await runFfprobe(input, { ...options, ...overrides, execute })).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('does not report verification when the Linux probe fails', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ kind: 'unavailable' }).mockResolvedValueOnce({ kind: 'failed' });
    expect(await runFfprobe(input, { ...options, execute })).toBeNull();
  });
  it('escapes CSV quotes and removes host input from the container argv', () => {
    const args = linuxFfprobeArgs('image:local', 'C:\\a"b.mp4', input.args, 'own-container');
    expect(args).toContain('type=bind,"source=C:\\a""b.mp4",target=/media/input,readonly');
    expect(args.at(-1)).toBe('/media/input');
  });
});
