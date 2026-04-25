/**
 * @monobrain/mcp - Sampling (Server-Initiated LLM)
 *
 * MCP 2025-11-25 compliant sampling for server-initiated LLM calls
 */
import { EventEmitter } from 'events';
import type { ModelPreferences, CreateMessageRequest, CreateMessageResult, ILogger } from './types.js';
/**
 * External LLM provider interface
 */
export interface LLMProvider {
    name: string;
    createMessage(request: CreateMessageRequest): Promise<CreateMessageResult>;
    isAvailable(): Promise<boolean>;
}
/**
 * Sampling configuration
 */
export interface SamplingConfig {
    /** Default model preferences */
    defaultModelPreferences?: ModelPreferences;
    /** Maximum tokens for any request */
    maxTokensLimit?: number;
    /** Default temperature */
    defaultTemperature?: number;
    /** Timeout for LLM calls (ms) */
    timeout?: number;
    /** Enable request logging */
    enableLogging?: boolean;
}
/**
 * Sampling request context
 */
export interface SamplingContext {
    sessionId: string;
    serverId?: string;
    metadata?: Record<string, unknown>;
}
export declare class SamplingManager extends EventEmitter {
    private readonly logger;
    private readonly config;
    private providers;
    private defaultProvider?;
    private requestCount;
    private totalTokens;
    constructor(logger: ILogger, config?: Partial<SamplingConfig>);
    /**
     * Register an LLM provider
     */
    registerProvider(provider: LLMProvider, isDefault?: boolean): void;
    /**
     * Unregister a provider
     */
    unregisterProvider(name: string): boolean;
    /**
     * Create a message (sampling/createMessage)
     */
    createMessage(request: CreateMessageRequest, context?: SamplingContext): Promise<CreateMessageResult>;
    /**
     * Check if sampling is available
     */
    isAvailable(): Promise<boolean>;
    /**
     * Get available providers
     */
    getProviders(): string[];
    /**
     * Get stats
     */
    getStats(): {
        requestCount: number;
        totalTokens: number;
        providerCount: number;
        defaultProvider?: string;
    };
    /**
     * Validate sampling request
     */
    private validateRequest;
    /**
     * Select provider based on preferences
     */
    private selectProvider;
    /**
     * Apply default values to request
     */
    private applyDefaults;
    /**
     * Call with timeout
     */
    private callWithTimeout;
}
export declare function createSamplingManager(logger: ILogger, config?: Partial<SamplingConfig>): SamplingManager;
/**
 * Create a mock LLM provider for testing
 */
export declare function createMockProvider(name?: string): LLMProvider;
/**
 * Create an Anthropic provider (requires API key)
 */
export declare function createAnthropicProvider(apiKey: string): LLMProvider;
//# sourceMappingURL=sampling.d.ts.map