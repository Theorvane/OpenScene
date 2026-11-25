import { describe, expect, it } from 'vitest';

const helperPath = '../scripts/cua-harness-readiness.mjs';
const { waitForNativeMenuReady } = await import(helperPath);

describe('native menu harness readiness', () => {
  const run = (samples: object[]) => {
    let clock = 0;
    let index = 0;
    return waitForNativeMenuReady({ command: 'undo', timeoutMs: 3,
      now: () => clock, pause: async () => { clock++; },
      read: async () => samples[Math.min(index++, samples.length - 1)] });
  };
  it('waits past a DOM commit until the focused renderer report and native enabled state agree', async () => {
    await expect(run([
      { domPosition: 124, enabled: false },
      { domPosition: 124, enabled: false, report: { senderMatches: true, enabled: true } },
      { domPosition: 124, enabled: true, report: { senderMatches: true, enabled: true } }
    ])).resolves.toMatchObject({ enabled: true });
  });
  it.each([
    ['permanent missing report', { enabled: true }],
    ['wrong sender', { enabled: true, report: { senderMatches: false, enabled: true } }],
    ['native never enabled', { enabled: false, report: { senderMatches: true, enabled: true } }],
    ['renderer never enabled', { enabled: true, report: { senderMatches: true, enabled: false } }]
  ])('fails boundedly with telemetry for %s', async (_name, sample) => {
    await expect(run([sample])).rejects.toMatchObject({ message: 'Timed out: native undo readiness', telemetry: sample });
  });
});
