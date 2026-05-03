/**
 * Graphify MCP Tools — DEPRECATED SHIMS
 *
 * All graphify_* tools are deprecated. They proxy to monograph_* tools.
 * Will be removed in next major release.
 */

import type { MCPTool } from './types.js';
import { monographTools } from './monograph-tools.js';

function findMonographTool(name: string): MCPTool {
  const tool = monographTools.find(t => t.name === name);
  if (!tool) throw new Error(`[monograph] Tool ${name} not found`);
  return tool;
}

function shimTool(graphifyName: string, monographName: string, paramMap?: (input: Record<string, unknown>) => Record<string, unknown>): MCPTool {
  const target = findMonographTool(monographName);
  return {
    name: graphifyName,
    description: `[DEPRECATED: use ${monographName}] ${target.description}`,
    inputSchema: target.inputSchema,
    handler: async (input, ctx) => {
      console.warn(`[monograph] ${graphifyName} is deprecated, use ${monographName}`);
      const mapped = paramMap ? paramMap(input) : input;
      return target.handler(mapped, ctx);
    },
  };
}

export const graphifyTools: MCPTool[] = [
  shimTool('graphify_build', 'monograph_build'),
  shimTool('graphify_query', 'monograph_query'),
  shimTool('graphify_god_nodes', 'monograph_god_nodes'),
  shimTool('graphify_get_node', 'monograph_get_node'),
  shimTool('graphify_shortest_path', 'monograph_shortest_path'),
  shimTool('graphify_community', 'monograph_community'),
  shimTool('graphify_stats', 'monograph_stats'),
  shimTool('graphify_surprises', 'monograph_surprises'),
  // Bug fix: graphify_suggest used to ignore prompt — now maps to monograph_suggest with task param
  shimTool('graphify_suggest', 'monograph_suggest', (input) => ({
    task: input.prompt ?? input.task ?? '',
    limit: input.limit,
  })),
  shimTool('graphify_visualize', 'monograph_visualize'),
  shimTool('graphify_watch', 'monograph_watch'),
  shimTool('graphify_watch_stop', 'monograph_watch_stop'),
  shimTool('graphify_report', 'monograph_report'),
  // Bug fix: graphify_health previously referenced `files.length` (ReferenceError) — now delegates cleanly
  shimTool('graphify_health', 'monograph_health'),
];

export default graphifyTools;
