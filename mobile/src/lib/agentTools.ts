import { timelineDurationMs } from '@openvideo/shared/timelineLogic';
import type { ToolSchema } from './agentChatClient';
import { readProject } from './projectStore';

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
      const tracks = project.timeline.tracks
        .map((track) => `${track.name} (${track.kind}, ${track.clips.length} clips)`)
        .join('; ');
      return {
        summary: `"${project.name}" runs ${(timelineDurationMs(project.timeline) / 1000).toFixed(1)}s across ${
          project.timeline.tracks.length
        } tracks: ${tracks}. ${project.assets.length} assets imported.`
      };
    }
  }
];
export function findTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find(tool => tool.name === name);
}
