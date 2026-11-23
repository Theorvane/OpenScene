import { describe, expect, it, vi } from 'vitest';
import type { AgentChatModelHandle } from '../src/main/agentChatGraph';
import { AIMessage } from '@langchain/core/messages';
import { selectShortsCandidates, type ShortsSelectionInput } from '../src/shared/shortsCandidateSelection';
import { createShortsCandidateProvider } from '../src/main/shortsCandidateProvider';

// Fixed source fixture: setup/conclusion, repeated passage, and an independent scene.
const fixture: ShortsSelectionInput = {
  sourceAssetId: 'source', sourceDurationMs: 90000,
  transcript: [
    { id: 'setup', startMs: 0, endMs: 10000, text: 'Why does bread rise?' },
    { id: 'answer', startMs: 10000, endMs: 20000, text: 'Yeast produces gas, expanding the dough.' },
    { id: 'repeat-setup', startMs: 30000, endMs: 40000, text: 'Why does bread rise?' },
    { id: 'repeat-answer', startMs: 40000, endMs: 50000, text: 'Yeast produces gas, expanding the dough.' }
  ], sceneClues: [{ id: 'scene', startMs: 60000, endMs: 80000, description: 'A complete before/after baking demonstration.' }]
};
function proposal(first = 'setup', last = 'answer') {
  return { firstEvidenceId: first, lastEvidenceId: last, reason: 'Question followed by the explanation of yeast producing gas.',
    evidenceIds: first === last ? [first] : [first, last], context: { completeThought: true, notes: 'Includes question and answer.' } };
}
const signal = () => new AbortController().signal;
describe('evidence-grounded shorts selection', () => {
  it('derives exact source ranges, keeps context and suppresses repeated passages', async () => {
    const original = JSON.stringify(fixture);
    const result = await selectShortsCandidates(fixture, async () => ({ candidates: [proposal(), proposal('repeat-setup', 'repeat-answer'), proposal('scene', 'scene')] }), signal());
    expect(result.status).toBe('insufficient-evidence');
    expect(result.candidates.map(c => [c.startMs, c.endMs])).toEqual([[0, 20000], [60000, 80000]]);
    expect(JSON.stringify(fixture)).toBe(original);
  });
  it('does not call provider for absent evidence or fill missing candidates', async () => {
    const provider = vi.fn();
    expect((await selectShortsCandidates({ ...fixture, transcript: [], sceneClues: [] }, provider, signal())).candidates).toEqual([]);
    expect(provider).not.toHaveBeenCalled();
    expect((await selectShortsCandidates(fixture, async () => ({ candidates: [] }), signal())).status).toBe('insufficient-evidence');
  });
  it('accepts a requested single complete candidate and omits incomplete thoughts', async () => {
    expect((await selectShortsCandidates({ ...fixture, requestedCount: 1 }, async () => ({ candidates: [proposal()] }), signal())).status).toBe('completed');
    expect((await selectShortsCandidates(fixture, async () => ({ candidates: [{ ...proposal(), context: { completeThought: false, notes: 'Needs setup' } }] }), signal())).candidates).toEqual([]);
  });
  it.each([NaN, Infinity, -1, 0.5, 90001])('rejects invalid source evidence end %s before provider invocation', async endMs => {
    const provider = vi.fn();
    await expect(selectShortsCandidates({ ...fixture, transcript: [{ ...fixture.transcript[0]!, endMs }] }, provider, signal())).rejects.toThrow();
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([
    { candidates: [{ ...proposal(), startMs: 999 }] },
    { candidates: [proposal('missing', 'answer')] },
    { candidates: [proposal('answer', 'setup')] },
    { candidates: [{ ...proposal(), evidenceIds: ['setup', 'answer', 'scene'] }] },
    { candidates: [{ ...proposal(), context: {} }] },
    { candidates: [{ ...proposal(), reason: '' }] },
    { candidates: 'invalid' }, null
  ])('rejects malformed or invented provider evidence', async response => {
    await expect(selectShortsCandidates(fixture, async () => response, signal())).rejects.toThrow();
  });
  it('rejects duplicate evidence IDs and unordered cues', async () => {
    await expect(selectShortsCandidates({ ...fixture, sceneClues: [{ ...fixture.sceneClues[0]!, id: 'setup' }] }, vi.fn(), signal())).rejects.toThrow();
    await expect(selectShortsCandidates({ ...fixture, transcript: [...fixture.transcript].reverse() }, vi.fn(), signal())).rejects.toThrow();
  });
  it('suppresses overlap above half the shorter range', async () => {
    const result = await selectShortsCandidates({ ...fixture, minDurationMs: 1000 }, async () => ({ candidates: [proposal(), proposal('answer', 'answer')] }), signal());
    expect(result.candidates).toHaveLength(1);
  });
  it('propagates provider failure', async () => {
    await expect(selectShortsCandidates(fixture, async () => { throw new Error('provider offline'); }, signal())).rejects.toThrow('provider offline');
  });
  it('rejects cancellation before invocation', async () => {
    const controller = new AbortController(); controller.abort(); const provider = vi.fn();
    await expect(selectShortsCandidates(fixture, provider, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(provider).not.toHaveBeenCalled();
  });
  it('cancels an uncooperative provider and ignores its late result', async () => {
    const controller = new AbortController(); let resolve!: (value: unknown) => void;
    const pending = selectShortsCandidates(fixture, () => new Promise(r => { resolve = r; }), controller.signal);
    await Promise.resolve(); controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    resolve({ candidates: [proposal()] });
  });
  it('adapter invokes configured model with signal and parses real wire-shaped content', async () => {
    const invoke = vi.fn<AgentChatModelHandle["invoke"]>(async () => new AIMessage(JSON.stringify({ candidates: [proposal()] })));
    const currentSignal = signal();
    const result = await selectShortsCandidates(fixture, createShortsCandidateProvider({ invoke }), currentSignal);
    expect(result.candidates[0]?.startMs).toBe(0);
    expect(invoke.mock.calls[0]?.[1]).toEqual({ signal: currentSignal });
  });
  it('adapter rejects invalid JSON', async () => {
    const provider = createShortsCandidateProvider({ invoke: async () => new AIMessage('```json {} ```') });
    await expect(provider(fixture, signal())).rejects.toThrow('invalid JSON');
  });
});
