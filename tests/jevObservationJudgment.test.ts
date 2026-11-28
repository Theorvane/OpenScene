import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJevObservationHook, DEFAULT_JEV_CONFIG, JEV_ENDPOINT, JEV_MODEL, type JevObservationContext } from '../src/main/jevObservationJudgment';
import type { CuaFrame } from '../src/shared/cua';
import { AIMessage, isToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { buildAgentChatGraph } from '../src/main/agentChatGraph';
import { AgentChatSessionManager } from '../src/main/agentChatSession';

const frame: CuaFrame = {
  sessionId: 'session', runId: 'run', windowId: 1, frameId: 'frame', layoutRevision: 1,
  contentRevision: 1, capturedAt: 100, pngDataUrl: 'data:image/png;base64,aW1hZ2U=',
  viewport: { width: 20, height: 20 }, bitmap: { width: 20, height: 20 }, deviceScaleFactor: 1, zoomFactor: 1
};
const answer = () => ({ model: JEV_MODEL, answers: { judgment: { type: 'choice', choice: 'reobserve',
  confidence: 0.98, probabilities: { reobserve: 0.99, sufficient: 0.01 } } }, usage: { input_tokens: 100, output_tokens: 2 } });
function fixture() {
  let config = { ...DEFAULT_JEV_CONFIG, enabled: true };
  const run = new AbortController();
  let context: JevObservationContext | null = {
    currentFrame: structuredClone(frame), heldInputCount: 0, cleanupComplete: true, signal: run.signal,
    kind: 'reobserve', instructions: 'Is another explicit observation needed to understand this screen?',
    candidates: [{ id: 'reobserve', description: 'The view is incomplete or transitional.' }, { id: 'sufficient', description: 'The view is readable.' }], imageTransmissionAuthorized: true
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(answer()));
  const getApiKey = vi.fn(async () => 'fake-key-for-test-only');
  const release = vi.fn();
  const hook = createJevObservationHook({ getConfig: () => config, getApiKey,
    getObservationContext: () => context, acquireJudgmentLease: () => ({ frame: context!.currentFrame!, signal: run.signal,
      getCurrentFrame: () => context?.currentFrame ?? null, release }), fetch, now: () => 101 });
  return { hook, fetch, getApiKey, run, release, call: () => hook({ conversationId: 'c', output: { success: true, frame } }),
    setConfig: (value: Partial<typeof config>) => { config = { ...config, ...value }; },
    setContext: (value: Partial<JevObservationContext> | null) => { context = value === null ? null : { ...context!, ...value }; } };
}
afterEach(() => vi.useRealTimers());
describe('Jev explicit observation advisory', () => {
  it('defaults off and reads neither key nor network', async () => {
    const f = fixture(); f.setConfig({ enabled: false });
    expect(await f.call()).toBeNull(); expect(f.getApiKey).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('bounds repeated explicit observations to three requests per run then falls back', async () => {
    const f = fixture();
    for (let index = 0; index < 5; index++) {
      const fresh = { ...frame, frameId: `fresh-${index}` };
      f.setContext({ currentFrame: fresh });
      const result = await f.hook({ conversationId: 'c', output: { success: true, frame: fresh } });
      expect(result !== null).toBe(index < 3);
    }
    expect(f.fetch).toHaveBeenCalledTimes(3);
  });
  it('sends the official pinned image/choice contract once with no redirect or retries', async () => {
    const f = fixture();
    expect(await f.call()).toEqual({ source: 'jev-advisory', model: JEV_MODEL, frameId: 'frame', kind: 'reobserve', selectedId: 'reobserve', selectedProbability: 0.99 });
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(url).toBe(JEV_ENDPOINT); expect(init?.redirect).toBe('error');
    expect(init?.headers).toEqual({ Authorization: 'Bearer fake-key-for-test-only', 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Images': 'true' });
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: 'jev-1.14.0', questions: { judgment: { type: 'choice', criteria: { reobserve: expect.any(String), sufficient: expect.any(String) } } }, assets: { '<observed-frame>': { format: 'png', data_base64: 'aW1hZ2U=' } } });
    expect(await f.call()).toBeNull(); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ heldInputCount: 1 }, { cleanupComplete: false }, { currentFrame: null }])('never sends while unsafe: %j', async patch => {
    const f = fixture(); f.setContext(patch); expect(await f.call()).toBeNull(); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('sends metadata only unless image disclosure is explicitly authorized', async () => {
    const f = fixture(); f.setContext({ imageTransmissionAuthorized: false });
    expect(await f.call()).not.toBeNull();
    const init = f.fetch.mock.calls[0]![1]!;
    expect(init.headers).not.toHaveProperty('TypeSafe-Danger-Zone-Images');
    expect(JSON.parse(init.body as string)).not.toHaveProperty('assets');
    expect(init.body).not.toContain('aW1hZ2U=');
  });
  it.each(['sessionId', 'runId', 'windowId', 'frameId', 'layoutRevision', 'contentRevision'] as const)('rejects stale %s before sending', async field => {
    const f = fixture(); f.setContext({ currentFrame: { ...frame, [field]: typeof frame[field] === 'number' ? 99 : 'other' } });
    expect(await f.call()).toBeNull(); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('rechecks safety after key retrieval', async () => {
    const f = fixture(); f.getApiKey.mockImplementation(async () => { f.setContext({ heldInputCount: 1 }); return 'fake'; });
    expect(await f.call()).toBeNull(); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('does not send after the user disables the setting during key retrieval', async () => {
    const f = fixture(); f.getApiKey.mockImplementation(async () => { f.setConfig({ enabled: false }); return 'fake'; });
    expect(await f.call()).toBeNull(); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('discards a response after the threshold changes in flight', async () => {
    const f = fixture(); f.fetch.mockImplementation(async () => { f.setConfig({ minSelectedProbability: 0.98 }); return Response.json(answer()); });
    expect(await f.call()).toBeNull();
  });
  it.each(['disable', 'model-change'])('discards response after %s in flight', async mode => {
    const f = fixture(); f.fetch.mockImplementation(async () => {
      f.setConfig(mode === 'disable' ? { enabled: false } : { model: 'unsupported-model' as typeof JEV_MODEL });
      return Response.json(answer());
    });
    expect(await f.call()).toBeNull(); expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('drops stale network responses', async () => {
    const f = fixture(); f.fetch.mockImplementation(async () => { f.setContext({ currentFrame: { ...frame, contentRevision: 2 } }); return Response.json(answer()); });
    expect(await f.call()).toBeNull();
  });
  it('rejects duplicate candidate IDs before network', async () => {
    const f = fixture(); f.setContext({ candidates: [{ id: 'x', description: 'one' }, { id: 'x', description: 'two' }] });
    expect(await f.call()).toBeNull(); expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each(['unknown', 'extra-probability', 'missing-probability', 'wrong-model', 'uncertain', 'malformed', 'oversized', 'http-error'])('falls back on %s without retries', async kind => {
    const f = fixture();
    f.fetch.mockImplementation(async () => {
      const value = answer();
      if (kind === 'unknown') value.answers.judgment.choice = 'invented';
      if (kind === 'extra-probability') Object.assign(value.answers.judgment.probabilities, { invented: 0 });
      if (kind === 'missing-probability') Reflect.deleteProperty(value.answers.judgment.probabilities, 'sufficient');
      if (kind === 'wrong-model') Object.assign(value, { model: 'jev-latest' });
      if (kind === 'uncertain') value.answers.judgment.probabilities = { reobserve: 0.6, sufficient: 0.4 };
      if (kind === 'malformed') return new Response('{');
      if (kind === 'oversized') return new Response(' '.repeat(32769));
      if (kind === 'http-error') return new Response('private-key-error', { status: 429 });
      return Response.json(value);
    });
    expect(await f.call()).toBeNull(); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('returns on deadline even if fetch ignores cancellation', async () => {
    vi.useFakeTimers(); const f = fixture(); f.fetch.mockImplementation(() => new Promise(() => undefined));
    const result = f.call(); await vi.advanceTimersByTimeAsync(2500);
    expect(await result).toBeNull(); expect(f.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(f.release).not.toHaveBeenCalled();
  });
  it('aborts an in-flight request when the trusted run stops', async () => {
    const f = fixture(); f.fetch.mockImplementation(async () => { f.run.abort(); return Response.json(answer()); });
    expect(await f.call()).toBeNull();
  });
  it('keeps key retrieval, network exceptions and missing keys opaque', async () => {
    const f = fixture(); f.getApiKey.mockRejectedValue(new Error('fake-private-key'));
    expect(await f.call()).toBeNull(); expect(f.fetch).not.toHaveBeenCalled();
  });
});

describe('Jev graph observation contact', () => {
  it.each(['reobserve', 'sufficient', 'uncertain', 'failure', 'absent', 'disabled'] as const)('routes explicit evidence while preserving existing model with %s', async mode => {
    const f = fixture();
    if (mode === 'disabled') f.setConfig({ enabled: false });
    if (mode === 'sufficient') f.fetch.mockImplementation(async () => { const value = answer(); value.answers.judgment.choice = 'sufficient'; value.answers.judgment.probabilities = { reobserve: 0.01, sufficient: 0.99 }; return Response.json(value); });
    if (mode === 'uncertain') f.fetch.mockImplementation(async () => { const value = answer(); value.answers.judgment.probabilities = { reobserve: 0.6, sufficient: 0.4 }; return Response.json(value); });
    // The actual registered CUA tool returns a JSON string, not an object.
    const observe = vi.fn(async () => JSON.stringify({ success: true, summary: 'Explicit editor observation.', frame }));
    let step = 0;
    let observedContent = '';
    let imageCount = 0;
    const bundle = buildAgentChatGraph({
      tools: [tool(observe, { name: 'observeEditorWindow', description: 'Observe editor', schema: z.object({}) })],
      mutatingToolNames: new Set(),
      ...(mode === 'absent' ? {} : { jevObservationHook: mode === 'failure' ? async () => { throw new Error('private'); } : f.hook }),
      createModel: () => ({ invoke: async messages => {
        if (step++ === 0) return new AIMessage({ content: '', tool_calls: [{ id: 'observation', name: 'observeEditorWindow', args: {} }] });
        const message = messages.find(m => isToolMessage(m) && m.name === 'observeEditorWindow');
        observedContent = String(message?.content);
        imageCount = messages.filter(m => Array.isArray(m.content) && m.content.some(part => typeof part === 'object' && part !== null && part.type === 'image_url')).length;
        return new AIMessage('Existing model continues.');
      } })
    });
    const result = await new AgentChatSessionManager(bundle).sendMessage({ conversationId: 'c', text: 'Inspect', modelId: 'qwen2.5-coder', interactionMode: 'self-window' });
    expect(result.status).toBe('idle');
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observedContent).toContain('Explicit editor observation.');
    expect(observedContent.includes('jev-advisory')).toBe(mode === 'reobserve' || mode === 'sufficient');
    expect(f.fetch).toHaveBeenCalledTimes(['reobserve', 'sufficient', 'uncertain'].includes(mode) ? 1 : 0);
    expect(imageCount).toBe(mode === 'reobserve' ? 0 : 1);
    expect(observedContent).not.toContain('fake-key');
  });
});
