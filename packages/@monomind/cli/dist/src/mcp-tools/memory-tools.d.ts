/**
 * Memory MCP Tools — Phase 6 of ADR-053
 *
 * Exposes Memory backend operations as MCP tools.
 * Provides direct access to ReasoningBank, CausalGraph, SkillLibrary,
 * AttestationLog, and bridge health through the MCP protocol.
 *
 * Security: All handlers validate input types, enforce length bounds,
 * and sanitize error messages before returning to MCP callers.
 *
 * @module v1/cli/mcp-tools/memory-tools
 */
import type { MCPTool } from './types.js';
export declare const memoryHealth: MCPTool;
export declare const memoryControllers: MCPTool;
export declare const memoryPatternStore: MCPTool;
export declare const memoryPatternSearch: MCPTool;
export declare const memoryFeedback: MCPTool;
export declare const memoryCausalEdge: MCPTool;
export declare const memoryRoute: MCPTool;
export declare const memorySessionStart: MCPTool;
export declare const memorySessionEnd: MCPTool;
export declare const memoryHierarchicalStore: MCPTool;
export declare const memoryHierarchicalRecall: MCPTool;
export declare const memoryConsolidate: MCPTool;
export declare const memoryBatch: MCPTool;
export declare const memoryContextSynthesize: MCPTool;
export declare const memorySemanticRoute: MCPTool;
export declare const memoryTools: MCPTool[];
//# sourceMappingURL=memory-tools.d.ts.map