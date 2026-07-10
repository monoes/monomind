/**
 * Hooks Advanced MCP Tools — wires genuinely unique @monomind/hooks/mcp tools
 * into the CLI's live MCP tool registry.
 *
 * Background: @monomind/hooks/src/mcp/index.ts defined a full parallel MCP tool
 * surface (hooksMCPTools) that was exported from the package's public barrel but
 * had zero consumers anywhere — the CLI's actual MCP server (mcp-client.ts) built
 * its own independent implementations in hooks-routing.ts / hooks-intelligence.ts.
 * Several of those hooks-package tools were pure stub duplicates (hardcoded fake
 * data) of the CLI's real, wired versions and were deleted outright. The tools
 * re-exported below are genuinely unique — they wrap real subsystems
 * (AFLOW/DAGLearner/LATS search, EvoAgentX GEPA prompt evolution, RLVR verifiable
 * rewards, trace observability, human-in-the-loop interrupt checkpoints) that have
 * no CLI equivalent — so instead of deleting them, they are wired in here.
 */

import { type MCPTool } from './types.js';
import {
  routeAdvancedTool,
  statuslineTool,
  evoAgentXTool,
  rlvrOutcomeTool,
  traceMCPTools,
  checkpointMCPTools,
} from '@monomind/hooks';

export const hooksAdvancedTools: MCPTool[] = [
  routeAdvancedTool,
  statuslineTool,
  evoAgentXTool,
  rlvrOutcomeTool,
  ...traceMCPTools,
  ...checkpointMCPTools,
] as unknown as MCPTool[];
