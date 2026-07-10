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
  hooksWorkerList,
  hooksWorkerDispatch,
  hooksWorkerStatus,
  hooksWorkerDetect,
  hooksWorkerCancel,
  hooksModelRoute,
  hooksModelOutcome,
  hooksModelStats,
} from './hooks-intelligence.js';

import { hooksAdvancedTools } from './hooks-advanced.js';
import { hooksSynthesisTools } from './hooks-synthesis.js';

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
  // Worker tools
  hooksWorkerList,
  hooksWorkerDispatch,
  hooksWorkerStatus,
  hooksWorkerDetect,
  hooksWorkerCancel,
  // Model routing tools
  hooksModelRoute,
  hooksModelOutcome,
  hooksModelStats,
  // Advanced tools salvaged from @monomind/hooks/mcp (AFLOW/DAGLearner routing,
  // EvoAgentX prompt evolution, RLVR verifiable rewards, trace + HIL checkpoints)
  ...hooksAdvancedTools,
  // Dynamic agent synthesis (Task 47) — prompt/register/status/promote/cleanup
  ...hooksSynthesisTools,
];

export default hooksTools;
