import { useEffect, useState, type ReactElement } from 'react';
import { ProgramMonitor } from './ProgramMonitor';
import { SourceMediaPreview } from './SourceMediaPreview';
import type { TimelineEditorController } from './useTimelineEditor';

/** One preview owner across all editing presentations; source time is explicitly separate. */
export function EditorPreview({ editor, active, onSourceModeChange, sourceMode }: { readonly editor: TimelineEditorController; readonly active: boolean; readonly onSourceModeChange?: (source: boolean) => void; readonly sourceMode?: boolean }): ReactElement {
  const [inspectSource, setInspectSource] = useState(false);
  const project = editor.project;
  const hasClips = project?.timeline.tracks.some(track => track.clips.length > 0) ?? false;
  const hasVideo = project?.assets.some(asset => asset.kind === 'video') ?? false;
  const source = sourceMode ?? (hasVideo && (inspectSource || !hasClips));
  const transcript = project?.ai?.transcriptionDraft;
  useEffect(() => { setInspectSource(false); }, [project?.id]);
  useEffect(() => { if (!active || source) editor.setIsPlaying(false); }, [active, source, editor.setIsPlaying]);
  return <section className="editor-preview" aria-label="영상 미리보기">
    <div className="editor-preview__toolbar">
      <div role="group" aria-label="미리보기 대상">
        <button type="button" data-testid="preview-edit" aria-pressed={!source} disabled={!hasClips} onClick={() => { setInspectSource(false); onSourceModeChange?.(false); }}>편집 결과</button>
        <button type="button" data-testid="preview-source" aria-pressed={source} disabled={!hasVideo} onClick={() => { editor.setIsPlaying(false); setInspectSource(true); onSourceModeChange?.(true); }}>원본</button>
      </div>
      <button type="button" disabled={editor.isBusy} onClick={() => { void editor.importAssets(); }}>영상 추가</button>
    </div>
    {source && project !== null
      ? <SourceMediaPreview key={project.id} projectId={project.id} assets={project.assets} selectedAssetId={editor.selectedAsset?.id ?? null} onSelectAsset={editor.setSelectedAssetId} active={active}
          captionSource={transcript ? { projectId: project.id, assetId: transcript.sourceAssetId, captions: transcript.cues } : null} />
      : <ProgramMonitor editor={editor} />}
  </section>;
}
