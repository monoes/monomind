/**
 * Hooks Intelligence MCP Tools
 * MCP tool implementations for intelligence reset, trajectories, patterns,
 * intelligence stats/learn/attention, and model routing.
 * Extracted from hooks-tools.ts.
 * The simulated worker dispatch/status/detect/cancel tools were deleted with
 * the worker daemon -- real workers live in @monomind/hooks (`hooks worker run`).
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
export declare const hooksModelRoute: MCPTool;
export declare const hooksModelOutcome: MCPTool;
export declare const hooksModelStats: MCPTool;
//# sourceMappingURL=hooks-intelligence.d.ts.map