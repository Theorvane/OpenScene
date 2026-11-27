import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import type { MediaAsset } from '../../../shared/timelineTypes';
import { type ReaAnalysisJob, type ReaAnalysisRuntime } from '../../../shared/reaVideoAnalysis';
import './rea-video-analysis.css';

export type ReaVideoAnalysisWorkspaceProps = {
  readonly projectId: string;
  readonly assets: readonly MediaAsset[];
  readonly trackId: string;
  readonly atMs: number;
  readonly sourceEpoch: string;
  /** Host must dispatch through normal editor history/dirty state; this component never saves. */
  readonly onImportOperations: (operations: readonly unknown[], context: { readonly projectId: string; readonly sourceEpoch: string; readonly trackId: string; readonly atMs: number }) => void;
};
/** Dedicated slot; host mounting is coordinated separately from FE576-owned files. */
export function ReaVideoAnalysisWorkspace({ projectId, assets, trackId, atMs, sourceEpoch, onImportOperations }: ReaVideoAnalysisWorkspaceProps) {
  const [runtime, setRuntime] = useState<ReaAnalysisRuntime>();
  const [assetId, setAssetId] = useState('');
  const [job, setJob] = useState<ReaAnalysisJob>();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const generation = useRef(0);
  const importing = useRef(false);
  const contextKey = JSON.stringify([projectId, sourceEpoch, assetId, trackId, atMs]);
  const latestContext = useRef(contextKey); latestContext.current = contextKey;
  const latestJob = useRef(job); latestJob.current = job;
  useEffect(() => {
    const token = ++generation.current;
    setJob(undefined); setSelected([]); setAssetId(''); setStarting(false); setError('');
    void window.videoTool.reaAnalysisRuntime().then(result => { if (generation.current === token && result.ok) setRuntime(result.value); }).catch(() => { if (generation.current === token) setError('Runtime inspection unavailable.'); });
    return () => { generation.current++; const previous = latestJob.current; if (previous && (previous.status === 'running' || previous.status === 'review')) void window.videoTool.reaAnalysisCancel({ jobId: previous.id }).catch(() => undefined); };
  }, [projectId, sourceEpoch]);
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    let active = true;
    const poll = setInterval(() => {
      void window.videoTool.reaAnalysisGet({ jobId: job.id }).then(result => {
        if (!active) return;
        if (result.ok) setJob(result.value); else setError(result.error.message);
      }).catch(() => { if (active) setError('Local analysis status unavailable.'); });
    }, 400);
    return () => { active = false; clearInterval(poll); };
  }, [job?.id, job?.status]);
  const start = async () => {
    const token = generation.current; setStarting(true); setError(''); setSelected([]); setJob(undefined);
    if (job?.status === 'review') void window.videoTool.reaAnalysisCancel({ jobId: job.id }).catch(() => undefined);
    try {
      const result = await window.videoTool.reaAnalysisStart({ projectId, assetId });
      if (generation.current !== token) { if (result.ok) void window.videoTool.reaAnalysisCancel({ jobId: result.value.id }).catch(() => undefined); return; }
      if (result.ok) setJob(result.value); else setError(result.error.message);
    } catch { if (generation.current === token) setError('Local analysis unavailable.'); }
    finally { if (generation.current === token) setStarting(false); }
  };
  const cancel = async () => {
    if (!job) return;
    // Retire pending preparation immediately, before main acknowledges cancellation.
    generation.current++;
    setSelected([]); setJob(undefined);
    try { await window.videoTool.reaAnalysisCancel({ jobId: job.id }); }
    catch { setError('Cancellation request failed.'); }
  };
  const download = () => {
    if (!job?.videoMd) return;
    const url = URL.createObjectURL(new Blob([job.videoMd], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'VIDEO.md'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const videos = assets.filter(asset => asset.kind === 'video');
  const importReviewed = async () => {
    if (!job?.plan || importing.current) return;
    importing.current = true;
    const token = generation.current, key = contextKey;
    const context = { projectId, sourceEpoch, trackId, atMs };
    try {
      const response = await window.videoTool.reaAnalysisPrepareImport({ projectId, assetId: job.assetId, jobId: job.id, shotIds: selected, trackId, prefix: `rea-${crypto.randomUUID()}`, atMs });
      if (generation.current !== token || latestContext.current !== key) return;
      if (response.ok) onImportOperations(response.value, context); else setError(response.error.message);
    } catch { if (generation.current === token) setError('Import failed. Check the source, target track and placement.'); }
    finally { importing.current = false; }
  };
  return <section className="rea-analysis" aria-label="Local shot analysis">
    <h2>Local shot analysis</h2>
    <p>Measured cut candidates and a manual recreation checklist. Semantic analysis, speech recognition and video generation are unavailable. No upload or model download.</p>
    <p>Upstream rea-video is an analysis and planning tool. This initial OpenScene adapter measures timing with FFmpeg; it does not run the upstream Python pipeline.</p>
    {runtime && !runtime.available && <p role="status">{runtime.reason}</p>}
    {runtime && <p>Upstream Python pipeline unavailable: dependencies and model licenses require separate review. Python 3.10+: {runtime.python?.status ?? 'not inspected'}{runtime.python?.version ? ` (${runtime.python.version})` : ''}. Local timing analysis does not require Python.</p>}
    <label>Imported video <select value={assetId} disabled={starting || job?.status === 'running'} onChange={event => { setAssetId(event.target.value); setSelected([]); setJob(undefined); if (job) void window.videoTool.reaAnalysisCancel({ jobId: job.id }).catch(() => undefined); }}><option value="">Choose a video</option>{videos.map(asset => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}</select></label>
    <Button disabled={!runtime?.available || !videos.some(asset => asset.id === assetId) || starting || job?.status === 'running'} onClick={() => void start()}>Analyze locally</Button>
    {(job?.status === 'running' || job?.status === 'review') && <Button onClick={() => void cancel()}>Cancel analysis</Button>}
    {job && <p role="status">{job.status}{job.error ? `: ${job.error}` : ''}{job.cleanupComplete ? ' · Local process settled; no temporary media retained.' : ''}</p>}
    {error && <p role="alert">{error}</p>}
    {job?.plan && <>
      <p>Review ranges against the original. Scene detection can miss cuts and mistake flashes for cuts.</p>
      <table><thead><tr><th>Import</th><th>Shot</th><th>Source range (seconds)</th><th>Recreation plan</th></tr></thead><tbody>{job.plan.shots.map(shot => <tr key={shot.id}>
        <td><input type="checkbox" aria-label={`Select ${shot.id}`} checked={selected.includes(shot.id)} onChange={event => setSelected(current => event.target.checked ? [...current, shot.id] : current.filter(id => id !== shot.id))} /></td>
        <td>{shot.id}</td><td>{(shot.sourceStartMs / 1000).toFixed(3)}–{(shot.sourceEndMs / 1000).toFixed(3)}</td><td>Inspect source; describe subject, camera and replacement manually.</td>
      </tr>)}</tbody></table>
      <Button disabled={!selected.length || !trackId || job.projectId !== projectId || !videos.some(asset => asset.id === job.assetId)} onClick={() => void importReviewed()}>Import reviewed original ranges</Button>
      <Button onClick={download}>Download VIDEO.md</Button>
      <details><summary>Review VIDEO.md</summary><pre>{job.videoMd}</pre></details>
    </>}
  </section>;
}
