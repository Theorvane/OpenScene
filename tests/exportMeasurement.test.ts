import { describe, expect, it, vi } from 'vitest';
import * as childProcess from 'node:child_process';
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { ffprobeArgs, ffprobePathFor, parseFfprobeOutput, measureExportedFile } from '../src/main/exportMeasurement';

describe('measuring a finished export with the discovered toolchain', () => {
  it('returns unchecked when Windows refuses to launch the probe synchronously', async () => {
    const spawn = vi.mocked(childProcess.spawn).mockImplementationOnce(() => { throw new Error('spawn UNKNOWN'); });
    try {
      await expect(measureExportedFile({ ffmpegPath: '/tools/ffmpeg.exe', filePath: '/exports/cut.mp4' })).resolves.toBeNull();
    } finally { spawn.mockReset(); }
  });
  it('looks for ffprobe beside ffmpeg, keeping the platform naming', () => {
    expect(ffprobePathFor('/usr/local/bin/ffmpeg')).toBe('/usr/local/bin/ffprobe');
    expect(ffprobePathFor('/opt/tools/ffmpeg.exe')).toBe('/opt/tools/ffprobe.exe');
    // A path that says nothing about ffmpeg is not rewritten by guessing.
    expect(ffprobePathFor('/opt/tools/encoder')).toBe('/opt/tools/ffprobe');
  });

  it('asks only for what the review compares', () => {
    const args = ffprobeArgs('/exports/cut.mp4');
    expect(args).toContain('-of');
    expect(args).toContain('json');
    expect(args.at(-1)).toBe('/exports/cut.mp4');
  });

  it('reads size, length, frame rate and sound out of the probe', () => {
    const measurement = parseFfprobeOutput(
      JSON.stringify({
        streams: [
          { codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
          { codec_type: 'audio' }
        ],
        format: { duration: '6.612000' }
      })
    );
    expect(measurement).toMatchObject({ widthPx: 1920, heightPx: 1080, durationMs: 6_612, hasSoundTrack: true });
    expect(measurement?.frameRate).toBeCloseTo(29.97, 2);
  });

  it('leaves the frame rate out when the container reports none, rather than calling it zero', () => {
    const measurement = parseFfprobeOutput(
      JSON.stringify({
        streams: [{ codec_type: 'video', width: 1080, height: 1920, avg_frame_rate: '0/0' }],
        format: { duration: '3' }
      })
    );
    expect(measurement).toEqual({ widthPx: 1080, heightPx: 1920, durationMs: 3_000, hasSoundTrack: false });
  });
  it('uses displayed axes for phone rotation before planning portrait contain', () => {
    const source = { codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30/1' };
    for (const metadata of [{ side_data_list: [{ rotation: -90 }] }, { tags: { rotate: '90' } }]) {
      expect(parseFfprobeOutput(JSON.stringify({ streams: [{ ...source, ...metadata }], format: { duration: '12' } }))).toMatchObject({ widthPx: 1080, heightPx: 1920 });
    }
    expect(parseFfprobeOutput(JSON.stringify({ streams: [{ ...source, side_data_list: [{ rotation: 45 }] }], format: { duration: '12' } }))).toBeNull();
  });

  it('reports a file with no video stream as having no picture', () => {
    const measurement = parseFfprobeOutput(JSON.stringify({ streams: [{ codec_type: 'audio' }], format: { duration: '5' } }));
    expect(measurement).toEqual({ widthPx: 0, heightPx: 0, durationMs: 0, hasSoundTrack: true });
  });

  it('returns nothing measured for output it cannot read', () => {
    expect(parseFfprobeOutput('')).toBeNull();
    expect(parseFfprobeOutput('ffprobe version 6.0')).toBeNull();
    expect(parseFfprobeOutput(JSON.stringify({ format: { duration: '5' } }))).toBeNull();
  });
});
