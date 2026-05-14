/**
 * AgentDB MCP Tools — Phase 6 of ADR-053
 *
 * Exposes AgentDB v1 controller operations as MCP tools.
 * Provides direct access to ReasoningBank, CausalGraph, SkillLibrary,
 * AttestationLog, and bridge health through the MCP protocol.
 *
 * Security: All handlers validate input types, enforce length bounds,
 * and sanitize error messages before returning to MCP callers.
 *
 * @module v1/cli/mcp-tools/agentdb-tools
 */
import type { MCPTool } from './types.js';
export declare const agentdbHealth: MCPTool;
export declare const agentdbControllers: MCPTool;
export declare const agentdbPatternStore: MCPTool;
export declare const agentdbPatternSearch: MCPTool;
export declare const agentdbFeedback: MCPTool;
export declare const agentdbCausalEdge: MCPTool;
export declare const agentdbRoute: MCPTool;
export declare const agentdbSessionStart: MCPTool;
export declare const agentdbSessionEnd: MCPTool;
export declare const agentdbHierarchicalStore: MCPTool;
export declare const agentdbHierarchicalRecall: MCPTool;
export declare const agentdbConsolidate: MCPTool;
export declare const agentdbBatch: MCPTool;
export declare const agentdbContextSynthesize: MCPTool;
export declare const agentdbSemanticRoute: MCPTool;
export declare const agentdbTools: MCPTool[];
//# sourceMappingURL=agentdb-tools.d.ts.map