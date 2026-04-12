/**
 * @monobrain/mcp - Tool Registry
 *
 * High-performance tool management with O(1) lookup
 */
import { EventEmitter } from 'events';
import type { MCPTool, JSONSchema, ToolHandler, ToolContext, ToolCallResult, ToolRegistrationOptions, ILogger } from './types.js';
interface ToolMetadata {
    tool: MCPTool;
    registeredAt: Date;
    callCount: number;
    lastCalled?: Date;
    avgExecutionTime: number;
    errorCount: number;
}
interface ToolSearchOptions {
    category?: string;
    tags?: string[];
    deprecated?: boolean;
    cacheable?: boolean;
}
export declare class ToolRegistry extends EventEmitter {
    private readonly logger;
    private readonly tools;
    private readonly categoryIndex;
    private readonly tagIndex;
    private defaultContext?;
    private totalRegistrations;
    private totalLookups;
    private totalExecutions;
    constructor(logger: ILogger);
    register(tool: MCPTool, options?: ToolRegistrationOptions): boolean;
    registerBatch(tools: MCPTool[], options?: ToolRegistrationOptions): {
        registered: number;
        failed: string[];
    };
    unregister(name: string): boolean;
    getTool(name: string): MCPTool | undefined;
    hasTool(name: string): boolean;
    getToolCount(): number;
    getToolNames(): string[];
    listTools(): Array<{
        name: string;
        description: string;
        category?: string;
        tags?: string[];
        deprecated?: boolean;
    }>;
    search(options: ToolSearchOptions): MCPTool[];
    getByCategory(category: string): MCPTool[];
    getByTag(tag: string): MCPTool[];
    getCategories(): string[];
    getTags(): string[];
    execute(name: string, input: Record<string, unknown>, context?: ToolContext): Promise<ToolCallResult>;
    setDefaultContext(context: ToolContext): void;
    getMetadata(name: string): ToolMetadata | undefined;
    getStats(): {
        totalTools: number;
        totalCategories: number;
        totalTags: number;
        totalRegistrations: number;
        totalLookups: number;
        totalExecutions: number;
        topTools: Array<{
            name: string;
            calls: number;
        }>;
    };
    validateTool(tool: MCPTool): {
        valid: boolean;
        errors: string[];
    };
    private validateSchema;
    private updateAverageExecutionTime;
    clear(): void;
}
export declare function createToolRegistry(logger: ILogger): ToolRegistry;
export declare function defineTool<TInput = Record<string, unknown>, TOutput = unknown>(name: string, description: string, inputSchema: JSONSchema, handler: ToolHandler<TInput, TOutput>, options?: {
    category?: string;
    tags?: string[];
    version?: string;
    deprecated?: boolean;
    cacheable?: boolean;
    cacheTTL?: number;
    timeout?: number;
}): MCPTool<TInput, TOutput>;
export {};
//# sourceMappingURL=tool-registry.d.ts.map