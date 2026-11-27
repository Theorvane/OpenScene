// Test-only fail-closed boundary. Install and verify before importing the app.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { ChatOllama } from '@langchain/ollama';

export function installWorkspaceQaNetworkGuard() {
  const telemetry = { enabledBeforeProductImport: false, probes: [], modelAttempts: [], httpAttempts: [] };
  let phase = 'negative-probe';
  const sentinel = 'QA_NO_LIVE_NETWORK';
  const originals = { fetch: globalThis.fetch, invoke: ChatOllama.prototype.invoke, stream: ChatOllama.prototype.stream,
    request: http.request, get: http.get, secureRequest: https.request, secureGet: https.get, connect: net.Socket.prototype.connect };
  const record = (kind) => {
    const entry = { phase, kind };
    (phase === 'negative-probe' ? telemetry.probes : kind === 'model-invoke' ? telemetry.modelAttempts : telemetry.httpAttempts).push(entry);
  };
  const fail = (kind) => { record(kind); throw new Error(sentinel); };
  ChatOllama.prototype.invoke = async function () { fail('model-invoke'); };
  ChatOllama.prototype.stream = async function () { fail('model-invoke'); };
  globalThis.fetch = async () => fail('fetch');
  http.request = () => fail('http.request'); http.get = () => fail('http.get');
  https.request = () => fail('https.request'); https.get = () => fail('https.get');
  net.Socket.prototype.connect = function () { fail('net.connect'); };
  syncBuiltinESMExports();
  return {
    telemetry,
    async verifyBeforeStartup() {
      // These hit the installed throwing boundaries, never the original
      // transport. The model probe follows the application's bindTools path.
      await assert.rejects(() => new ChatOllama({ model: 'qa-fixture', baseUrl: 'http://127.0.0.1:11434' }).bindTools([]).invoke('negative-probe'), new RegExp(sentinel));
      await assert.rejects(() => globalThis.fetch('http://127.0.0.1:11434/api/chat'), new RegExp(sentinel));
      assert.throws(() => http.request('http://127.0.0.1:11434/api/chat'), new RegExp(sentinel));
      assert.throws(() => https.request('https://invalid.example/negative-probe'), new RegExp(sentinel));
      assert.throws(() => new net.Socket().connect(11434, '127.0.0.1'), new RegExp(sentinel));
      telemetry.enabledBeforeProductImport = true;
      phase = 'product';
    },
    // Register as Chromium's onBeforeRequest handler before app-window load.
    chromiumRequest(_details, callback) { record('chromium-http'); callback({ cancel: true }); },
    assertNoProductAttempts() {
      assert.equal(telemetry.modelAttempts.length, 0, 'No product model invocation attempt');
      assert.equal(telemetry.httpAttempts.length, 0, 'No product HTTP/socket request attempt');
    },
    restore() {
      globalThis.fetch = originals.fetch;
      ChatOllama.prototype.invoke = originals.invoke; ChatOllama.prototype.stream = originals.stream;
      http.request = originals.request; http.get = originals.get; https.request = originals.secureRequest; https.get = originals.secureGet;
      net.Socket.prototype.connect = originals.connect; syncBuiltinESMExports();
    }
  };
}
