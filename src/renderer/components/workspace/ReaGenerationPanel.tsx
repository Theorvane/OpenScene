import { useEffect, useRef, useState } from 'react';
import type { MediaAsset } from '../../../shared/timelineTypes';
import type { ReaGenerationPlan } from '../../../shared/reaGeneration';
import type { ReaGenerationCapability, ReaGenerationPrepared } from '../../../shared/reaGenerationApi';

/** Review preparation only. No submit operation is exposed by this product dependency. */
export function ReaGenerationPanel({ projectId, sourceEpoch, assets }: {
  readonly projectId: string; readonly sourceEpoch: string; readonly assets: readonly MediaAsset[];
}) {
  const [capability, setCapability] = useState<ReaGenerationCapability>();
  const [key, setKey] = useState(''); const [sourceId, setSourceId] = useState(''); const [prompt, setPrompt] = useState('');
  const [seconds, setSeconds] = useState(4); const [budget, setBudget] = useState('0.32');
  const [prepared, setPrepared] = useState<ReaGenerationPrepared>(); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const latestPrepared = useRef(prepared); latestPrepared.current = prepared;
  const revision = useRef(0);
  const identity = JSON.stringify([projectId, sourceEpoch, sourceId, prompt, seconds, budget]);
  const current = useRef(identity); if (current.current !== identity) { current.current = identity; revision.current++; }
  useEffect(() => {
    setPrepared(undefined); setMessage(''); setBusy(false);
    return () => {
      revision.current++;
      const previous = latestPrepared.current;
      if (previous) void window.videoTool.reaGenerationCancel({ id: previous.receipt.id, projectId: previous.plan.projectId }).catch(() => undefined);
    };
  }, [identity]);
  useEffect(() => { setKey(''); setCapability(undefined); setSourceId(''); }, [projectId, sourceEpoch]);
  const run = async (action: () => Promise<void>) => {
    const token = revision.current; setBusy(true); setMessage('');
    try { await action(); } catch { if (token === revision.current) setMessage('Request unavailable. No paid execution is enabled.'); }
    finally { if (token === revision.current) setBusy(false); }
  };
  const status = async () => {
    const token = revision.current, response = await window.videoTool.reaGenerationStatus();
    if (token !== revision.current) return;
    if (response.ok) setCapability(response.value); else setMessage(response.error.message);
  };
  const prepare = async () => {
    const token = revision.current, source = assets.find(a => a.id === sourceId && a.kind === 'video'); if (!source) return;
    const plan: ReaGenerationPlan = { version: 1, projectId, sourceAssetId: source.id, sourceEpoch, reviewVersion: token,
      shotId: 'manual-shot-1', sourceStartMs: 0, sourceEndMs: Math.max(1, Math.min(source.metadata?.durationMs ?? seconds * 1000, seconds * 1000)), prompt,
      provider: 'minimax-video-payg', baseUrl: 'https://api.minimax.io', model: 'MiniMax-H3', resolution: '768P', generateAudio: false,
      durationSeconds: seconds, ratio: '16:9', referenceImage: null,
      estimate: { currency: 'USD', outputMicroUsdPerSecond: 80000, totalMicroUsd: seconds * 80000, budgetMicroUsd: Math.round(Number(budget) * 1_000_000), pricedAt: '2026-11-27', billingCapGuaranteed: false },
      manifest: { prompt: true, firstFrame: false, sourceVideo: false, sourceAudio: false } };
    const response = await window.videoTool.reaGenerationPrepare(plan);
    if (token !== revision.current) { if (response.ok) void window.videoTool.reaGenerationCancel({ id: response.value.receipt.id, projectId }).catch(() => undefined); return; }
    if (response.ok) setPrepared(response.value); else setMessage(response.error.message);
  };
  return <section className="rea-analysis" aria-label="REA generation review">
    <h2>REA generation review</h2>
    <p>Global MiniMax PAYG · MiniMax-H3 · 768P · silent · one shot. Paid execution: false. Production adapter unavailable; offline protocol tests are implemented.</p>
    <p>Account access: unverified. Documentation checked: 2026-11-27. First-frame input, verified result preview, local assembly and generated timeline import are not enabled yet.</p>
    <details><summary>Dedicated video credential</summary>
      <p>Use a global PAYG video API key. Chat, China, coding and M Plan credentials are never reused. Configuring a key does not authorize spending.</p>
      <label>Video API key <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></label>
      <button disabled={busy || !key.trim()} onClick={() => void run(async () => {
        const value = key; setKey(''); const r = await window.videoTool.reaGenerationSetCredential({ value }); if (!r.ok) throw new Error(); await status();
      })}>Store dedicated key</button>
      <button disabled={busy} onClick={() => void run(async () => { setKey(''); const r = await window.videoTool.reaGenerationClearCredential(); if (!r.ok) throw new Error(); await status(); })}>Clear dedicated key</button>
      <button disabled={busy} onClick={() => void run(status)}>Check dedicated key status</button>
      <p role="status">Credential: {capability ? capability.credentialConfigured ? 'configured; access unverified' : 'setup required' : 'not checked'}.</p>
    </details>
    <label>Original video (kept local) <select value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">Choose a video</option>{assets.filter(a => a.kind === 'video').map(a => <option key={a.id} value={a.id}>{a.displayName}</option>)}</select></label>
    <label>Final prompt <textarea value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={12000} /></label>
    <label>Output seconds <input type="number" min={4} max={15} step={1} value={seconds} onChange={e => setSeconds(Number(e.target.value))} /></label>
    <label>Allowed budget (USD) <input inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} /></label>
    <p>Estimate: ${(seconds * 0.08).toFixed(2)} at $0.08/output second (2026-11-27); this is not a guaranteed billing cap. Transmission manifest: final prompt only; no original video/audio or image.</p>
    <button disabled={busy || !sourceId || !prompt.trim() || Boolean(prepared)} onClick={() => void run(prepare)}>Prepare one-shot approval review</button>
    {prepared && <div role="status"><p>Job: {prepared.receipt.state} · plan hash: {prepared.receipt.planHash}. Review expires after five minutes; changes invalidate it.</p>
      <pre>{JSON.stringify(prepared.plan, null, 2)}</pre><button disabled>Approve and generate — paid execution disabled</button>
      <button disabled={busy} onClick={() => void run(async () => { await window.videoTool.reaGenerationCancel({ id: prepared.receipt.id, projectId }); setPrepared(undefined); })}>Discard preparation</button>
    </div>}
    {message && <p role="alert">{message}</p>}
  </section>;
}
