import { describe, expect, it } from 'vitest';
import { runFfmpegPreparationProbe } from '../src/main/ffmpegEncoders';
describe('bounded export preparation process', () => {
  it('kills and waits for a process that never prints or exits', async () => {
    const start = Date.now();
    expect(await runFfmpegPreparationProbe(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 50)).toEqual({ stdout: '', exitCode: null });
    expect(Date.now() - start).toBeLessThan(2000);
  });
  it('caps output and settles after terminating an overflowing process', async () => {
    expect(await runFfmpegPreparationProbe(process.execPath, ['-e', 'process.stdout.write("x".repeat(2*1024*1024));setInterval(() => {},1000)'])).toEqual({ stdout: '', exitCode: null });
  });
  it('preserves successful listings and exit status for filter/encoder/audio checks', async () => {
    expect(await runFfmpegPreparationProbe(process.execPath, ['-e', 'process.stdout.write("drawtext")'])).toEqual({ stdout: 'drawtext', exitCode: 0 });
  });
});
