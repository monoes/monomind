/**
 * Hooks Intelligence & Worker MCP Tools
 * MCP tool implementations for intelligence reset, trajectories, patterns,
 * intelligence stats/learn/attention, worker dispatch/status/detect/cancel,
 * and model routing.
 * Extracted from hooks-tools.ts.
 */
import { type MCPTool } from './types.js';
export declare const hooksIntelligenceReset: MCPTool;
export declare const hooksTrajectoryStart: MCPTool;
export declare const hooksTrajectoryStep: MCPTool;
export declare const hooksTrajectoryEnd: MCPTool;
export declare const hooksPatternStore: MCPTool;
export declare const hooksPatternSearch: MCPTool;
export declare const hooksIntelligenceStats: MCPTool;
export declare const hooksIntelligenceLearn: MCPTool;
export declare const hooksIntelligenceAttention: MCPTool;
export declare const hooksWorkerList: MCPTool;
export declare const hooksWorkerDispatch: MCPTool;
export declare const hooksWorkerStatus: MCPTool;
export declare const hooksWorkerDetect: MCPTool;
export declare const hooksModelRoute: MCPTool;
export declare const hooksModelOutcome: MCPTool;
export declare const hooksModelStats: MCPTool;
export declare const hooksWorkerCancel: MCPTool;
//# sourceMappingURL=hooks-intelligence.d.ts.map