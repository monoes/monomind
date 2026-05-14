/**
 * CLI MCP Client
 *
 * Thin wrapper for calling MCP tools from CLI commands.
 * Implements ADR-005: MCP-First API Design - CLI as thin wrapper around MCP tools
 *
 * This provides a simple interface for CLI commands to call MCP tools without
 * containing hardcoded business logic. All business logic lives in MCP tool handlers.
 */
import type { MCPTool } from './mcp-tools/types.js';
/**
 * MCP Client Error
 */
export declare class MCPClientError extends Error {
    toolName: string;
    cause?: Error | undefined;
    constructor(message: string, toolName: string, cause?: Error | undefined);
}
/**
 * Call an MCP tool by name with input parameters
 *
 * @param toolName - Name of the MCP tool (e.g., 'agent_spawn', 'swarm_init')
 * @param input - Input parameters for the tool
 * @param context - Optional tool context
 * @returns Promise resolving to tool result
 * @throws {MCPClientError} If tool not found or execution fails
 *
 * @example
 * ```typescript
 * // Spawn an agent
 * const result = await callMCPTool('agent_spawn', {
 *   agentType: 'coder',
 *   priority: 'normal'
 * });
 *
 * // Initialize swarm
 * const swarm = await callMCPTool('swarm_init', {
 *   topology: 'hierarchical-mesh',
 *   maxAgents: 15
 * });
 * ```
 */
export declare function callMCPTool<T = unknown>(toolName: string, input?: Record<string, unknown>, context?: Record<string, unknown>): Promise<T>;
/**
 * Get tool metadata by name
 *
 * @param toolName - Name of the MCP tool
 * @returns Tool metadata or undefined if not found
 */
export declare function getToolMetadata(toolName: string): Omit<MCPTool, 'handler'> | undefined;
/**
 * List all available MCP tools
 *
 * @param category - Optional category filter
 * @returns Array of tool metadata
 */
export declare function listMCPTools(category?: string): Array<Omit<MCPTool, 'handler'>>;
/**
 * Check if an MCP tool exists
 *
 * @param toolName - Name of the MCP tool
 * @returns True if tool exists
 */
export declare function hasTool(toolName: string): boolean;
/**
 * Get all tool categories
 *
 * @returns Array of unique categories
 */
export declare function getToolCategories(): string[];
/**
 * Validate tool input against schema
 *
 * @param toolName - Name of the MCP tool
 * @param input - Input to validate
 * @returns Validation result with errors if any
 */
export declare function validateToolInput(toolName: string, input: Record<string, unknown>): {
    valid: boolean;
    errors?: string[];
};
declare const _default: {
    callMCPTool: typeof callMCPTool;
    getToolMetadata: typeof getToolMetadata;
    listMCPTools: typeof listMCPTools;
    hasTool: typeof hasTool;
    getToolCategories: typeof getToolCategories;
    validateToolInput: typeof validateToolInput;
    MCPClientError: typeof MCPClientError;
};
export default _default;
//# sourceMappingURL=mcp-client.d.ts.map