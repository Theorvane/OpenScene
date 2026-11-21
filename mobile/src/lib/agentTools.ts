import { timelineDurationMs } from '@openvideo/shared/timelineLogic';
import type { ToolSchema } from './agentChatClient';
import { readProject, writeProject } from './projectStore';
import { applyEditorOperations, editingCapabilities } from '@openvideo/shared/editorOperations';
import { CANVAS_BLOCK_CATALOG } from '@openvideo/shared/canvasBlockCatalog';
import { EMPTY_CANVAS_GRAPH } from '@openvideo/shared/videoCanvasGraph';
import { evaluateCanvasBlock } from '@openvideo/shared/videoCanvasBlocks';
import { projectEditorAssets } from './editorAssetMapping';
import { exportTimeline, deliverExport } from './exportComposition';

export type ToolResult = { readonly summary: string };
export type ToolContext = {
  readonly projectId: string | null;
  readonly onProgress?: (note: string) => void;
};
export type AgentTool = ToolSchema & {
  readonly run: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
};
export const AGENT_TOOLS: readonly AgentTool[] = [
{
    name: 'describe_timeline',
    description: 'Report the open project: its tracks, clips and total length. Free.',
    parameters: { type: 'object', properties: {} },
    run: async (_args, context) => {
      if (context.projectId === null) return { summary: 'No project is open.' };
      const project = readProject(context.projectId);
      if (project === null) return { summary: 'The open project could not be read.' };
      return {
        summary: JSON.stringify({ projectId: project.id, name: project.name, durationMs: timelineDurationMs(project.timeline),
          assets: project.assets.map(asset => ({ id: asset.id, label: asset.displayName, kind: asset.kind, durationMs: asset.durationMs })), timeline: project.timeline })
      };
    }
  },
  { name: 'get_editing_capabilities', description: 'Discover all supported canvas blocks/settings/quick starts and atomic editing operations. Free and read-only.', parameters: { type: 'object', properties: {} },
    run: async () => ({ summary: JSON.stringify({ ...editingCapabilities(), blocks: CANVAS_BLOCK_CATALOG }) }) },
  { name: 'get_canvas_workflow', description: 'Inspect saved canvas connections, original inputs and output readiness/durations. Free and read-only.', parameters: { type: 'object', properties: {} },
    run: async (_args, context) => {
      const project = context.projectId ? readProject(context.projectId) : null;
      if (!project) return { summary: 'No project is open.' };
      const graph = project.timeline.canvas ?? EMPTY_CANVAS_GRAPH;
      return { summary: JSON.stringify({ graph, outputs: graph.blocks.map(block => { const result = evaluateCanvasBlock(project.timeline, graph, block.id); return result.success ? { id: block.id, ready: true, durationMs: result.output.durationMs, type: result.output.type } : { id: block.id, ready: false, error: result.error }; }) }) };
    } },
  { name: 'edit_project', description: 'After user approval, atomically apply and save editing operations. Supports canvas blocks/templates/connections/apply, clips, tracks, effects, keyframes, titles including font/shadow, caption styles and transitions. Read get_editing_capabilities for fields. Times are milliseconds. A rejected batch changes nothing.',
    parameters: { type: 'object', properties: { operations: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'object', additionalProperties: true } } }, required: ['operations'] },
    run: async (args, context) => {
      const project = context.projectId ? readProject(context.projectId) : null;
      if (!project) return { summary: 'No project is open.' };
      const result = applyEditorOperations(project.timeline, args.operations as readonly unknown[], projectEditorAssets(project));
      if (!result.success) return { summary: JSON.stringify(result) };
      writeProject({ ...project, timeline: result.timeline });
      return { summary: JSON.stringify({ success: true, projectId: project.id, outputIds: result.outputIds }) };
    } },
  { name: 'export_project', description: 'After approval, render the current saved project locally and let the user save the resulting video. No media is uploaded by this tool.', parameters: { type: 'object', properties: {} },
    run: async (_args, context) => {
      const project = context.projectId ? readProject(context.projectId) : null;
      if (!project) return { summary: 'No project is open.' };
      context.onProgress?.('Rendering the saved timeline…');
      const result = await exportTimeline({ timeline: project.timeline, assets: projectEditorAssets(project), ...(project.frame ? { frame: project.frame } : {}), ...(project.subtitleDelivery ? { subtitleDelivery: project.subtitleDelivery } : {}) });
      if (!result.ok) return { summary: result.message };
      const delivery = await deliverExport(result.uri);
      return { summary: JSON.stringify({ success: true, review: result.review, delivery }) };
    } }
];
export function findTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find(tool => tool.name === name);
}
