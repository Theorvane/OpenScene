import { describe, expect, it } from 'vitest';
import { ChatOllama } from '@langchain/ollama';
import net from 'node:net';

describe('mounted workspace QA no-network boundary', () => {
  it('verifies real model binding, fetch, HTTP and socket tripwires before startup and rejects later attempts', async () => {
    const path = '../scripts/workspace-qa-network-guard.mjs';
    const { installWorkspaceQaNetworkGuard } = await import(path);
    const guard = installWorkspaceQaNetworkGuard();
    try {
      await guard.verifyBeforeStartup();
      expect(guard.telemetry.enabledBeforeProductImport).toBe(true);
      expect(guard.telemetry.probes.map((probe: { kind: string }) => probe.kind)).toEqual(['model-invoke', 'fetch', 'http.request', 'https.request', 'net.connect']);
      guard.assertNoProductAttempts();
      await expect(new ChatOllama({ model: 'qa-fixture' }).bindTools([]).invoke('fixture')).rejects.toThrow('QA_NO_LIVE_NETWORK');
      expect(() => new net.Socket().connect(11434, '127.0.0.1')).toThrow('QA_NO_LIVE_NETWORK');
      let cancelled = false;
      guard.chromiumRequest({}, (result: { cancel: boolean }) => { cancelled = result.cancel; });
      expect(cancelled).toBe(true);
      expect(() => guard.assertNoProductAttempts()).toThrow();
    } finally { guard.restore(); }
  });
});
