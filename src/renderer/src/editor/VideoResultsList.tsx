import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ShortsJob } from '../../../shared/shortsTypes';
import type { LocalExportJob } from '../../../shared/exportTypes';
import { videoResultsForProject } from '../../../shared/videoResults';
import { shouldPollShortsJob } from './shorts/shortsReviewState';
import type { TimelineEditorController } from './useTimelineEditor';
import { writeExportFramePreference } from './exportFramePreference';

const labels: Readonly<Record<ShortsJob['stage'], string>> = { selecting: '구간 분석 중', transcribing: '음성 전사 중', review: '구간 검토 대기 · 채팅에서 계속 진행', creating: '편집 결과 생성 중', exporting: 'MP4 내보내는 중', completed: '완료', partial: '일부 완료', failed: '실패', cancelling: '중지 중', cancelled: '중지됨' };

/** Observe existing jobs only. Mounting this list never starts a workflow or calls a model. */
export function VideoResultsList({ editor, active, onSelectProject, onInspectAsset }: { readonly editor: TimelineEditorController; readonly active: boolean; readonly onSelectProject?: ((id: string) => void) | undefined; readonly onInspectAsset: (id: string) => void }): ReactElement {
  const projectId = editor.project?.id ?? null;
  const [snapshot, setSnapshot] = useState<{ projectId: string; jobs: readonly ShortsJob[]; exports: ReadonlyMap<string, LocalExportJob> } | null>(null);
  const [issue, setIssue] = useState<{ projectId: string | null; message: string } | null>(null);
  const error = issue?.projectId === projectId ? issue?.message : null;
  const setError = (message: string | null) => setIssue(message === null ? null : { projectId, message });
  const [revision, setRevision] = useState(0);
  const owner = useRef(projectId); owner.current = projectId;
  useEffect(() => {
    if (!active || projectId === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const response = await window.videoTool.shortsList({ projectId });
        if (!live || owner.current !== projectId) return;
        if (!response.ok) { setError(response.error.message); return; }
        const jobs = response.value.filter(job => job.sourceProjectId === projectId);
        const ids = [...new Set(videoResultsForProject(projectId, jobs).flatMap(item => item.exportJobId ? [item.exportJobId] : []))];
        const exports = new Map<string, LocalExportJob>();
        await Promise.all(ids.map(async jobId => { const result = await window.videoTool.getExportJob({ jobId }); if (result.ok && result.value.id === jobId) exports.set(jobId, result.value); }));
        if (!live || owner.current !== projectId) return;
        setSnapshot({ projectId, jobs, exports }); setError(null);
      } catch { if (live && owner.current === projectId) setError('영상 작업 목록을 불러오지 못했습니다.'); }
      finally { if (live) timer = setTimeout(() => { void refresh(); }, 2000); }
    };
    void refresh();
    return () => { live = false; if (timer !== undefined) clearTimeout(timer); };
  }, [projectId, active, revision]);
  const jobs = snapshot?.projectId === projectId ? snapshot.jobs : [];
  const results = projectId === null ? [] : videoResultsForProject(projectId, jobs);
  const actOnExport = async (jobId: string, reveal: boolean): Promise<void> => {
    const scopedProject = projectId;
    try {
      const result = await (reveal ? window.videoTool.revealExportResult({ jobId }) : window.videoTool.openExportResult({ jobId }));
      if (owner.current === scopedProject && !result.ok) setError(result.error.message);
    } catch { if (owner.current === scopedProject) setError('완료된 영상 파일을 열지 못했습니다.'); }
  };
  const cancel = async (jobId: string): Promise<void> => {
    const scopedProject = projectId;
    try { const result = await window.videoTool.shortsCancel({ jobId }); if (owner.current === scopedProject) { if (!result.ok) setError(result.error.message); setRevision(n => n + 1); } }
    catch { if (owner.current === scopedProject) setError('작업 중지를 요청하지 못했습니다.'); }
  };
  const openResult = async (id: string): Promise<void> => {
    const scopedProject = projectId;
    try {
      if (editor.hasUnsavedTimeline && !await editor.saveTimeline()) return;
      if (owner.current !== scopedProject) return;
      await editor.refreshProjects();
      if (owner.current !== scopedProject) return;
      writeExportFramePreference(id, 'portrait');
      await editor.openProject(id);
    } catch { if (owner.current === scopedProject) setError('편집 결과 프로젝트를 열지 못했습니다.'); }
  };
  return <section className="video-results" aria-label="영상 목록">
    <header><h2>영상 목록</h2><button type="button" onClick={() => setRevision(n => n + 1)} aria-label="영상 목록 새로고침">↻</button></header>

    <h3>원본</h3>
    {editor.project?.assets.filter(asset => asset.kind === 'video').map(asset => <button type="button" className="video-results__source" key={asset.id} aria-pressed={editor.selectedAsset?.id === asset.id} onClick={() => onInspectAsset(asset.id)}>{asset.displayName}</button>)}
    {(editor.project?.assets.filter(asset => asset.kind === 'video').length ?? 0) === 0 && <p>영상을 추가하고 아래 채팅에서 편집을 요청하세요.</p>}
    {jobs.some(job => shouldPollShortsJob(job) || job.stage === 'review' || job.stage === 'failed' || job.stage === 'partial') && <h3>요청한 작업</h3>}
    {jobs.filter(job => shouldPollShortsJob(job) || job.stage === 'review' || job.stage === 'failed' || job.stage === 'partial').map(job => <div key={job.id} className="video-results__job"><span>{labels[job.stage]}</span>{job.error && <p>{job.error}</p>}{shouldPollShortsJob(job) && <button type="button" disabled={job.stage === 'cancelling'} onClick={() => { void cancel(job.id); }}>이 작업 중지</button>}</div>)}
    {results.length > 0 && <h3>편집 결과</h3>}
    {results.map(item => {
      const exported = item.exportJobId ? snapshot?.exports.get(item.exportJobId) : undefined;
      const completed = item.status === 'completed' && exported?.projectId === item.resultProjectId && exported.state.kind === 'completed';
      return <article key={item.resultProjectId} className="video-results__item">
        <button type="button" onClick={() => { void openResult(item.resultProjectId); }}>결과 {item.candidateId} · 편집 열기</button>
        <small>{completed ? 'MP4 완료' : item.status === 'ready' ? '편집 프로젝트 · 내보내기 전' : item.status === 'exporting' ? '내보내는 중' : item.status === 'completed' ? '완료 파일 확인 필요' : item.status === 'cancelled' ? '중지됨' : '결과 확인 필요'}</small>
        {item.error && <p>{item.error}</p>}
        {completed && item.exportJobId && <div><button type="button" onClick={() => { void actOnExport(item.exportJobId!, false); }}>MP4 재생 ↗</button><button type="button" onClick={() => { void actOnExport(item.exportJobId!, true); }}>파일 위치</button></div>}
      </article>;
    })}
    {error && <p role="alert">{error}</p>}
  </section>;
}
