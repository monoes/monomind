/**
 * CLI MCP Client — core tool roster (advertised vs. discovery-only tools)
 * Split out of mcp-client.ts (file-size sweep). Pure move.
 */

import { categoryFromToolName, ensureCategory } from './mcp-client-registry.js';
import type { MCPTool } from './mcp-tools/types.js';

/**
 * Core tool roster — the tools advertised via tools/list by default.
 * Everything else remains CALLABLE (callMCPTool/hasTool lazy-load any
 * category by name) and discoverable via monomind_tool_search, but is not
 * advertised, cutting the per-call schema payload from ~270 tools to ~20.
 * Set MONOMIND_MCP_FULL=1 to advertise all.
 *
 * Issue #410: the state-file tools (agent_/task_/session_/config_/system_/
 * guidance_/hooks_, mcp_status) are no longer advertised — they only read or
 * write JSON bookkeeping and cost ~20 KB of schema per session.
 */
export const FULL_ROSTER = process.env.MONOMIND_MCP_FULL === '1';

export const CORE_ADVERTISED_TOOLS = new Set([
  // monograph: code-graph navigation
  'monograph_build',
  'monograph_query',
  'monograph_suggest',
  'monograph_brief',
  'monograph_impact',
  'monograph_context',
  'monograph_neighbors',
  // agent/skill picking and hidden-tool discovery
  'pick',
  'org_skill_show',
  'monomind_tool_search',
  // document knowledge base (knowledge_remove: the generated CLAUDE.md tells
  // the model to retract stale documents with it)
  'knowledge_search',
  'knowledge_ingest',
  'knowledge_remove',
  'monodesign_detect',
  'monodesign_fix',
  'monodesign_palette',
  // memory: the Memory Loop in the generated CLAUDE.md/GEMINI.md/AGENTS.md
  // (pattern-store, kg_search, kg_ingest, feedback) and the KG_NUDGE
  // session-end hook (kg_stats glossary) name these tools directly.
  'memory_pattern-store',
  'memory_feedback',
  'memory_kg_ingest',
  'memory_kg_search',
  'memory_kg_stats',
  // mesh: finding other agents on this host. Three small tools (~2 KB of schema); without them in
  // the default roster a session has no reason to look for the mesh at all.
  'mesh_who',
  'mesh_join',
  'mesh_leave',
]);

/** Categories that hold at least one advertised tool (loaded by ensureCoreLoaded). */
export const CORE_TOOL_CATEGORIES = new Set([...CORE_ADVERTISED_TOOLS].map(categoryFromToolName));

export function isCoreAdvertised(tool: MCPTool): boolean {
  return CORE_ADVERTISED_TOOLS.has(tool.name);
}

let _coreLoaded = false;
export async function ensureCoreLoaded(): Promise<void> {
  if (_coreLoaded) return;
  _coreLoaded = true;
  await Promise.all([...CORE_TOOL_CATEGORIES].map((cat) => ensureCategory(cat)));
}
