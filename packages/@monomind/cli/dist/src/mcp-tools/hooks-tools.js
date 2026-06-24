/**
 * Hooks MCP Tools — Registration Layer
 * Thin registration module that aggregates all hooks MCP tools into a single array.
 * Business logic lives in hooks-embedding.ts, hooks-routing.ts, and hooks-intelligence.ts.
 */
import { hooksPreEdit, hooksPostEdit, hooksPreCommand, hooksPostCommand, hooksRoute, hooksMetrics, hooksList, hooksPreTask, hooksPostTask, hooksExplain, hooksPretrain, hooksBuildAgents, hooksTransfer, hooksSessionStart, hooksSessionEnd, hooksSessionRestore, hooksNotify, hooksInit, hooksIntelligence, } from './hooks-routing.js';
import { hooksIntelligenceReset, hooksTrajectoryStart, hooksTrajectoryStep, hooksTrajectoryEnd, hooksPatternStore, hooksPatternSearch, hooksIntelligenceStats, hooksIntelligenceLearn, hooksIntelligenceAttention, hooksWorkerList, hooksWorkerDispatch, hooksWorkerStatus, hooksWorkerDetect, hooksWorkerCancel, hooksModelRoute, hooksModelOutcome, hooksModelStats, } from './hooks-intelligence.js';
// Export all hooks tools
export const hooksTools = [
    hooksPreEdit,
    hooksPostEdit,
    hooksPreCommand,
    hooksPostCommand,
    hooksRoute,
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
    hooksSessionRestore,
    hooksNotify,
    hooksInit,
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
];
export default hooksTools;
//# sourceMappingURL=hooks-tools.js.map