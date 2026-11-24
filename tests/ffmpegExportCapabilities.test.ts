import { describe, expect, it } from 'vitest';
import { missingFfmpegEncoders } from '../src/shared/ffmpegExportCapabilities';
describe('compiled export encoder requirements', () => {
  const listing = ' V....D libx264 H.264 encoder\n A..... aac AAC encoder\n';
  it('requires only actual compiled video/audio encoders', () => {
    expect(missingFfmpegEncoders(['-c:v', 'libx264', '-c:a', 'aac'], listing)).toEqual([]);
    expect(missingFfmpegEncoders(['-c:v', 'libx264', '-an'], ' V....D libx264 encoder')).toEqual([]);
    expect(missingFfmpegEncoders(['-c:v', 'libx264', '-c:a', 'aac'], ' V....D libx264 encoder')).toEqual(['aac']);
    expect(missingFfmpegEncoders(['-c:v', 'libx264'], 'fake libx264 text')).toEqual(['libx264']);
  });
});
