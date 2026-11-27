import type { TimelineDocument } from '../../../shared/timelineTypes';
import type { NodeImpactSummary } from '../../components/workspace/workspaceTypes';

/** Presentation of the existing shared evaluator's result; no edit rules here. */
export function describeCanvasApplyImpact(before: TimelineDocument, after: TimelineDocument, workflowName: string): NodeImpactSummary {
  const nextClips = new Map(after.tracks.flatMap((track) => track.clips.map((clip) => [clip.id, { trackId: track.id, clip }] as const)));
  const changed = before.tracks.flatMap((track) => track.clips.filter((clip) => {
    const next = nextClips.get(clip.id);
    return next === undefined || next.trackId !== track.id || JSON.stringify(next.clip) !== JSON.stringify(clip);
  }));
  return {
    workflowName,
    preserveManualCaptions: false,
    items: [
      { id: 'clips', targetLabel: `기존 클립 ${changed.length}개 변경`, category: 'overwrite',
        detail: '현재 타임라인과 적용 결과를 비교했습니다. 해당 클립의 수동 트림·위치·효과도 바뀔 수 있습니다. 수동 편집 여부는 별도로 추적하지 않습니다.' },
      { id: 'transitions', targetLabel: `전환 ${before.transitions.length}개 → ${after.transitions.length}개`, category: 'overwrite',
        detail: '새 클립 배치에서 유효하지 않은 전환은 제거됩니다.' },
      { id: 'source', targetLabel: '원본 미디어 보존', category: 'preservable',
        detail: '타임라인만 변경합니다. 원본 미디어 파일은 수정하지 않습니다. 자막 선택 보존 기능은 제공하지 않습니다.' }
    ]
  };
}
