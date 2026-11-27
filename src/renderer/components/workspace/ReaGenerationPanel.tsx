import { useEffect, useRef, useState } from 'react';
import type { MediaAsset } from '../../../shared/timelineTypes';
import type { ReaGenerationPlan } from '../../../shared/reaGeneration';
import type { ReaGenerationCapability, ReaGenerationPrepared } from '../../../shared/reaGenerationApi';
import type { PreparedGenerationImport, VerifiedGenerationResult } from '../../../shared/reaGenerationResults';
import { MEDIA_PLAYBACK_SCHEME } from '../../../shared/mediaPlaybackUrls';

/** Review preparation only. No submit operation is exposed by this product dependency. */
export function ReaGenerationPanel({ projectId, sourceEpoch, assets, trackId = '', atMs = 0, onImport }: {
  readonly projectId: string; readonly sourceEpoch: string; readonly assets: readonly MediaAsset[];
  readonly trackId?: string; readonly atMs?: number; readonly onImport?: (prepared: PreparedGenerationImport) => void;
}) {
  const [capability, setCapability] = useState<ReaGenerationCapability>();
  const [key, setKey] = useState(''); const [sourceId, setSourceId] = useState(''); const [prompt, setPrompt] = useState('');
  const [imageId, setImageId] = useState('');
  const [seconds, setSeconds] = useState(4); const [budget, setBudget] = useState('0.32');
  const [prepared, setPrepared] = useState<ReaGenerationPrepared>(); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifiedGenerationResult>(); const [preview, setPreview] = useState(''); const [trimSeconds, setTrimSeconds] = useState(4);
  const latestPrepared = useRef(prepared); latestPrepared.current = prepared;
  const revision = useRef(0);
  const identity = JSON.stringify([projectId, sourceEpoch, sourceId, prompt, seconds, budget, trackId, atMs, imageId]);
  const current = useRef(identity); if (current.current !== identity) { current.current = identity; revision.current++; }
  useEffect(() => {
    setPrepared(undefined); setResult(undefined); setPreview(''); setMessage(''); setBusy(false);
    return () => {
      revision.current++;
      const previous = latestPrepared.current;
      if (previous) void window.videoTool.reaGenerationCancel({ id: previous.receipt.id, projectId: previous.plan.projectId }).catch(() => undefined);
    };
  }, [identity]);
  useEffect(() => { setKey(''); setCapability(undefined); setSourceId(''); setImageId(''); }, [projectId, sourceEpoch]);
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
    let referenceImage: ReaGenerationPlan['referenceImage'] = null;
    if (imageId) {
      const reference = await window.videoTool.reaGenerationReference({ projectId, assetId: imageId });
      if (token !== revision.current) return; if (!reference.ok) throw new Error(); referenceImage = reference.value;
    }
    const plan: ReaGenerationPlan = { version: 1, projectId, sourceAssetId: source.id, sourceEpoch, reviewVersion: token,
      shotId: 'manual-shot-1', sourceStartMs: 0, sourceEndMs: Math.max(1, Math.min(source.metadata?.durationMs ?? seconds * 1000, seconds * 1000)), prompt,
      provider: 'minimax-video-payg', baseUrl: 'https://api.minimax.io', model: 'MiniMax-H3', resolution: '768P', generateAudio: false,
      durationSeconds: seconds, ratio: referenceImage ? 'adaptive' : '16:9', referenceImage,
      estimate: { currency: 'USD', outputMicroUsdPerSecond: 80000, totalMicroUsd: seconds * 80000, budgetMicroUsd: Math.round(Number(budget) * 1_000_000), pricedAt: '2026-11-27', billingCapGuaranteed: false },
      manifest: { prompt: true, firstFrame: Boolean(referenceImage), sourceVideo: false, sourceAudio: false } };
    const response = await window.videoTool.reaGenerationPrepare(plan);
    if (token !== revision.current) { if (response.ok) void window.videoTool.reaGenerationCancel({ id: response.value.receipt.id, projectId }).catch(() => undefined); return; }
    if (response.ok) setPrepared(response.value); else setMessage(response.error.message);
  };
  const showResult = async (value: VerifiedGenerationResult, token: number) => {
    const playback = await window.videoTool.getAssetPlaybackUrl({ projectId, assetId: value.asset.id });
    if (token !== revision.current) return;
    if (value.projectId !== projectId || value.sourceEpoch !== sourceEpoch || !playback.ok || !playback.value.url.startsWith(`${MEDIA_PLAYBACK_SCHEME}:`)) throw new Error();
    setResult(value); setPreview(playback.value.url); setTrimSeconds(value.durationMs / 1000);
  };
  const refresh = async () => {
    if (!prepared) return; const token = revision.current;
    const status = await window.videoTool.reaGenerationGet({ id: prepared.receipt.id, projectId });
    if (token !== revision.current) return;
    if (!status.ok) throw new Error(); setPrepared({ ...prepared, receipt: status.value });
    const verified = await window.videoTool.reaGenerationGetResult({ jobId: prepared.receipt.id, projectId, sourceEpoch });
    if (token !== revision.current) return;
    if (verified.ok && verified.value) await showResult(verified.value, token);
  };
  return <section className="rea-analysis" aria-label="REA generation review">
    <h2>REA generation review</h2>
    <p>Global MiniMax PAYG · MiniMax-H3 · 768P · silent · one shot. Paid execution: false. Production adapter unavailable; offline protocol tests are implemented.</p>
    <p>Account access: unverified. Documentation checked: 2026-11-27. Remote success alone is not a verified local result; originals remain kept-original.</p>
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
    <label>Optional first frame <select value={imageId} onChange={e => setImageId(e.target.value)}><option value="">Text-to-video; no image</option>{assets.filter(a => a.kind === 'image' && ['image/png', 'image/jpeg'].includes(a.mimeType)).map(a => <option key={a.id} value={a.id}>{a.displayName}</option>)}</select></label>
    <label>Final prompt <textarea value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={12000} /></label>
    <label>Output seconds <input type="number" min={4} max={15} step={1} value={seconds} onChange={e => setSeconds(Number(e.target.value))} /></label>
    <label>Allowed budget (USD) <input inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} /></label>
    <p>Estimate: ${(seconds * 0.08).toFixed(2)} at $0.08/output second (2026-11-27); this is not a guaranteed billing cap. Transmission manifest: final prompt{imageId ? ' and one verified first-frame image' : ' only'}; no original video/audio. Nothing is transmitted while paid execution is disabled.</p>
    <button disabled={busy || !sourceId || !prompt.trim() || Boolean(prepared)} onClick={() => void run(prepare)}>Prepare one-shot approval review</button>
    {prepared && <div role="status"><p>Job: {prepared.receipt.state} · plan hash: {prepared.receipt.planHash}. Review expires after five minutes; changes invalidate it.</p>
      <pre>{JSON.stringify(prepared.plan, null, 2)}</pre><button disabled>Approve and generate — paid execution disabled</button>
      <button disabled={busy} onClick={() => void run(refresh)}>Refresh job and verified result</button>
      <button disabled={busy} onClick={() => void run(async () => { await window.videoTool.reaGenerationCancel({ id: prepared.receipt.id, projectId }); setPrepared(undefined); })}>Discard preparation</button>
    </div>}
    {result && preview && <section aria-label="Verified local result">
      <p>{result.label} · verified local MP4 · {(result.durationMs / 1000).toFixed(3)} seconds. No placeholder is counted as generated.</p>
      <video controls preload="metadata" src={preview} />
      <label>Local review trim (seconds) <input type="number" min={1} max={result.durationMs / 1000} step={0.001} value={trimSeconds} onChange={e => setTrimSeconds(Number(e.target.value))} /></label>
      <button disabled={busy} onClick={() => void run(async () => {
        const token = revision.current, response = await window.videoTool.reaGenerationAssemble({ jobId: result.jobId, projectId, sourceEpoch, targetDurationMs: Math.round(trimSeconds * 1000) });
        if (token !== revision.current) return; if (!response.ok) throw new Error(); await showResult(response.value, token);
      })}>Build local fit/trim review</button>
      <button disabled={busy || !trackId || !onImport} onClick={() => void run(async () => {
        const token = revision.current, response = await window.videoTool.reaGenerationPrepareImport({ jobId: result.jobId, projectId, sourceEpoch, trackId, atMs });
        if (token !== revision.current) return; if (!response.ok) throw new Error(); onImport?.(response.value);
      })}>Import verified result with Undo</button>
    </section>}
    {message && <p role="alert">{message}</p>}
  </section>;
}
