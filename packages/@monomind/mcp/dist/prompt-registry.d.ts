/**
 * @monobrain/mcp - Prompt Registry
 *
 * MCP 2025-11-25 compliant prompt management
 * Supports: list, get, arguments, templates, embedded resources
 */
import { EventEmitter } from 'events';
import type { MCPPrompt, PromptArgument, PromptMessage, PromptListResult, PromptGetResult, ResourceContent, ILogger } from './types.js';
export type PromptHandler = (args: Record<string, string>) => Promise<PromptMessage[]>;
export interface PromptDefinition extends MCPPrompt {
    handler: PromptHandler;
}
export interface PromptRegistryOptions {
    maxPrompts?: number;
    validateArguments?: boolean;
}
export declare class PromptRegistry extends EventEmitter {
    private readonly logger;
    private prompts;
    private readonly options;
    constructor(logger: ILogger, options?: PromptRegistryOptions);
    /**
     * Register a prompt
     */
    register(prompt: PromptDefinition): boolean;
    /**
     * Unregister a prompt
     */
    unregister(name: string): boolean;
    /**
     * List prompts with pagination
     */
    list(cursor?: string, pageSize?: number): PromptListResult;
    /**
     * Get a prompt with arguments
     */
    get(name: string, args?: Record<string, string>): Promise<PromptGetResult>;
    /**
     * Get prompt by name
     */
    getPrompt(name: string): MCPPrompt | undefined;
    /**
     * Check if prompt exists
     */
    hasPrompt(name: string): boolean;
    /**
     * Get prompt count
     */
    getPromptCount(): number;
    /**
     * Get stats
     */
    getStats(): {
        totalPrompts: number;
        promptsWithArgs: number;
    };
    /**
     * Encode cursor for pagination
     */
    private encodeCursor;
    /**
     * Decode cursor for pagination
     */
    private decodeCursor;
    /**
     * Emit listChanged notification
     */
    private emitListChanged;
}
export declare function createPromptRegistry(logger: ILogger, options?: PromptRegistryOptions): PromptRegistry;
/**
 * Helper to define a prompt
 */
export declare function definePrompt(name: string, description: string, handler: PromptHandler, options?: {
    title?: string;
    arguments?: PromptArgument[];
}): PromptDefinition;
/**
 * Helper to create a text message
 */
export declare function textMessage(role: 'user' | 'assistant', text: string): PromptMessage;
/**
 * Helper to create a message with embedded resource
 */
export declare function resourceMessage(role: 'user' | 'assistant', resource: ResourceContent): PromptMessage;
/**
 * Template string interpolation for prompts
 */
export declare function interpolate(template: string, args: Record<string, string>): string;
//# sourceMappingURL=prompt-registry.d.ts.map