/**
 * Hooks MCP Tools — Registration Layer
 * Thin registration module that aggregates all hooks MCP tools into a single array.
 * Business logic lives in hooks-embedding.ts, hooks-routing.ts, and hooks-intelligence.ts.
 */

import { type MCPTool } from './types.js';

import {
  hooksPreEdit,
  hooksPostEdit,
  hooksPreCommand,
  hooksPostCommand,
  hooksRoute,
  hooksRouteSemantic,
  hooksMetrics,
  hooksList,
  hooksPreTask,
  hooksPostTask,
  hooksExplain,
  hooksPretrain,
  hooksBuildAgents,
  hooksTransfer,
  hooksSessionStart,
  hooksSessionEnd,
  hooksIntelligence,
} from './hooks-routing.js';

import {
  hooksIntelligenceReset,
  hooksTrajectoryStart,
  hooksTrajectoryStep,
  hooksTrajectoryEnd,
  hooksPatternStore,
  hooksPatternSearch,
  hooksIntelligenceStats,
  hooksIntelligenceLearn,
  hooksIntelligenceAttention,
  hooksModelRoute,
  hooksModelOutcome,
  hooksModelStats,
} from './hooks-intelligence.js';

// Export all hooks tools
export const hooksTools: MCPTool[] = [
  hooksPreEdit,
  hooksPostEdit,
  hooksPreCommand,
  hooksPostCommand,
  hooksRoute,
  hooksRouteSemantic,
  hooksMetrics,
  hooksList,
  hooksPreTask,
  hooksPostTask,
  // New hooks
  hooksExplain,
  hooksPretrain,
  hooksBuildAgents,
  hooksTransfer,
  hooksSessionStart,
  hooksSessionEnd,
  hooksIntelligence,
  hooksIntelligenceReset,
  hooksTrajectoryStart,
  hooksTrajectoryStep,
  hooksTrajectoryEnd,
  hooksPatternStore,
  hooksPatternSearch,
  hooksIntelligenceStats,
  hooksIntelligenceLearn,
  hooksIntelligenceAttention,
  // Model routing tools
  hooksModelRoute,
  hooksModelOutcome,
  hooksModelStats,
  // NOTE: the "advanced" tools formerly re-exported from @monomind/hooks/mcp
  // (hooks/route-advanced, hooks/evo-agentx, hooks/rlvr-outcome, hooks/statusline,
  // trace + HIL checkpoint tools) and the hooks_synthesis-* tools were removed.
  // Their backing modules (AFLOW/LATS/GEPA/ReasoningBank) had already been
  // deleted, the handlers silently degraded to hardcoded data, and none of the
  // tools were ever invoked (no trace/checkpoint/ephemeral-agent artifacts ever
  // appeared on disk).
];

export default hooksTools;
