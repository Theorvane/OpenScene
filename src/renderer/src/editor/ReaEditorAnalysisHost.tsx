import { useId, useRef, useState } from 'react';
import { ReaVideoAnalysisWorkspace } from '../../components/workspace/ReaVideoAnalysisWorkspace';
import { ReaGenerationPanel } from '../../components/workspace/ReaGenerationPanel';
import type { TimelineEditorController } from './useTimelineEditor';

const REGION_SCROLL_KEYS = new Set(['Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']);

/** Desktop subprocess capability; imports use the active editor's atomic history boundary. */
export function ReaEditorAnalysisHost({ editor, locked }: { editor: TimelineEditorController; locked: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const project = editor.project;
  const trackId = project?.timeline.tracks.find(track => track.kind === 'video')?.id ?? '';
  // Include asset identity as well as committed content revision: reloads that return
  // identical bytes still retire the previous source session. Never derive from paths.
  const epoch = useRef({ assets: project?.assets, projectId: project?.id, sequence: 0 });
  if (epoch.current.assets !== project?.assets || epoch.current.projectId !== project?.id) {
    epoch.current = { assets: project?.assets, projectId: project?.id, sequence: epoch.current.sequence + 1 };
  }
  const sourceEpoch = `${epoch.current.sequence}:${editor.contentRevision}`;
  const context = { projectId: project?.id, sourceEpoch, trackId, atMs: editor.playheadMs, locked, open };
  const live = useRef(context); live.current = context;
  if (!project) return null;
  const expanded = open && !locked;
  return <section className="rea-editor-host" data-open={expanded} aria-label="Local analysis tools" tabIndex={expanded ? 0 : -1}
    data-cua-protected="chrome-menu" id="rea-editor-analysis" onKeyDown={event => {
      // The focused scroll region owns native navigation. Leave default browser
      // scrolling intact, and leave descendant controls/modifiers/IME untouched.
      if (expanded && event.target === event.currentTarget && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        && !event.nativeEvent.isComposing && REGION_SCROLL_KEYS.has(event.key)) event.stopPropagation();
    }}>
    <button type="button" disabled={locked} aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpen(value => !value)}>Local shot analysis</button>
    {expanded && <div id={panelId}>
      <p>Import placement: first video track · {(editor.playheadMs / 1000).toFixed(3)}s. Semantic analysis: not-run · generation: unavailable · paid execution: false.</p>
      {!trackId && <p role="status">Add a video track before importing reviewed ranges.</p>}
      <ReaVideoAnalysisWorkspace projectId={project.id} assets={project.assets} trackId={trackId} atMs={editor.playheadMs} sourceEpoch={sourceEpoch}
        onImportOperations={(operations, expected) => {
          const current = live.current;
          if (!current.open || current.locked || current.projectId !== expected.projectId || current.sourceEpoch !== expected.sourceEpoch || current.trackId !== expected.trackId || current.atMs !== expected.atMs) return;
          editor.applyEditingOperations(operations);
        }} />
      <ReaGenerationPanel key={`${project.id}:${sourceEpoch}`} projectId={project.id} sourceEpoch={sourceEpoch} assets={project.assets} />
    </div>}
  </section>;
}
