/**
 * Hooks MCP Tools — Registration Layer
 * Thin registration module that aggregates all hooks MCP tools into a single array.
 * Business logic lives in hooks-embedding.ts, hooks-routing.ts, and hooks-intelligence.ts.
 */

import {
  hooksIntelligenceLearn,
  hooksIntelligenceReset,
  hooksIntelligenceStats,
  hooksModelOutcome,
  hooksModelRoute,
  hooksModelStats,
  hooksPatternSearch,
  hooksPatternStore,
  hooksTrajectoryEnd,
  hooksTrajectoryStart,
  hooksTrajectoryStep,
} from './hooks-intelligence.js';

import {
  hooksExplain,
  hooksIntelligence,
  hooksList,
  hooksMetrics,
  hooksPostCommand,
  hooksPostEdit,
  hooksPostTask,
  hooksPreCommand,
  hooksPreEdit,
  hooksPreTask,
  hooksPretrain,
  hooksRoute,
  hooksRouteSemantic,
  hooksSessionEnd,
  hooksSessionRestore,
  hooksSessionStart,
  hooksTransfer,
} from './hooks-routing.js';
import type { MCPTool } from './types.js';

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
  hooksTransfer,
  hooksSessionStart,
  hooksSessionRestore,
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
  // Model routing tools
  hooksModelRoute,
  hooksModelOutcome,
  hooksModelStats,
  // NOTE: the "advanced" tools formerly re-exported from @monoes/hooks/mcp
  // (hooks/route-advanced, hooks/evo-agentx, hooks/rlvr-outcome, hooks/statusline,
  // trace + HIL checkpoint tools) and the hooks_synthesis-* tools were removed.
  // Their backing modules (AFLOW/LATS/GEPA/ReasoningBank) had already been
  // deleted, the handlers silently degraded to hardcoded data, and none of the
  // tools were ever invoked (no trace/checkpoint/ephemeral-agent artifacts ever
  // appeared on disk).
];

export default hooksTools;
