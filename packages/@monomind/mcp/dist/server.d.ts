/**
 * @monobrain/mcp - MCP Server
 *
 * High-performance MCP server implementation
 */
import { EventEmitter } from 'events';
import type { MCPServerConfig, MCPSession, MCPTool, MCPServerMetrics, ILogger } from './types.js';
import { ResourceRegistry } from './resource-registry.js';
import { PromptRegistry } from './prompt-registry.js';
import { TaskManager } from './task-manager.js';
import { RateLimiter } from './rate-limiter.js';
import { SamplingManager, type LLMProvider } from './sampling.js';
export interface IMCPServer {
    start(): Promise<void>;
    stop(): Promise<void>;
    registerTool(tool: MCPTool): boolean;
    registerTools(tools: MCPTool[]): {
        registered: number;
        failed: string[];
    };
    getHealthStatus(): Promise<{
        healthy: boolean;
        error?: string;
        metrics?: Record<string, number>;
    }>;
    getMetrics(): MCPServerMetrics;
    getSessions(): MCPSession[];
    getSession(sessionId: string): MCPSession | undefined;
    terminateSession(sessionId: string): boolean;
}
export declare class MCPServer extends EventEmitter implements IMCPServer {
    private readonly logger;
    private readonly orchestrator?;
    private readonly swarmCoordinator?;
    private readonly config;
    private readonly toolRegistry;
    private readonly sessionManager;
    private readonly resourceRegistry;
    private readonly promptRegistry;
    private readonly taskManager;
    private readonly connectionPool?;
    private readonly transportManager;
    private readonly rateLimiter;
    private readonly samplingManager;
    private transport?;
    private running;
    private startTime?;
    private startupDuration?;
    private currentSession?;
    private resourceSubscriptions;
    private readonly serverInfo;
    private readonly protocolVersion;
    private capabilities;
    private requestStats;
    constructor(config: Partial<MCPServerConfig>, logger: ILogger, orchestrator?: unknown | undefined, swarmCoordinator?: unknown | undefined);
    /**
     * Get resource registry for external registration
     */
    getResourceRegistry(): ResourceRegistry;
    /**
     * Get prompt registry for external registration
     */
    getPromptRegistry(): PromptRegistry;
    /**
     * Get task manager for async operations
     */
    getTaskManager(): TaskManager;
    /**
     * Get rate limiter for configuration
     */
    getRateLimiter(): RateLimiter;
    /**
     * Get sampling manager for LLM provider registration
     */
    getSamplingManager(): SamplingManager;
    /**
     * Register an LLM provider for sampling
     */
    registerLLMProvider(provider: LLMProvider, isDefault?: boolean): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    registerTool(tool: MCPTool): boolean;
    registerTools(tools: MCPTool[]): {
        registered: number;
        failed: string[];
    };
    unregisterTool(name: string): boolean;
    getHealthStatus(): Promise<{
        healthy: boolean;
        error?: string;
        metrics?: Record<string, number>;
    }>;
    getMetrics(): MCPServerMetrics;
    getSessions(): MCPSession[];
    getSession(sessionId: string): MCPSession | undefined;
    terminateSession(sessionId: string): boolean;
    private handleRequest;
    private handleNotification;
    private handleInitialize;
    private routeRequest;
    private handleToolsList;
    private handleToolsCall;
    private handleToolExecution;
    private handleResourcesList;
    private handleResourcesRead;
    private handleResourcesSubscribe;
    private handleResourcesUnsubscribe;
    private handlePromptsList;
    private handlePromptsGet;
    private handleTasksStatus;
    private handleTasksCancel;
    private handleCompletion;
    private handleLoggingSetLevel;
    private handleSamplingCreateMessage;
    private sendNotification;
    private getOrCreateSession;
    private createErrorResponse;
    private registerBuiltInTools;
    private setupEventHandlers;
}
export declare function createMCPServer(config: Partial<MCPServerConfig>, logger: ILogger, orchestrator?: unknown, swarmCoordinator?: unknown): MCPServer;
//# sourceMappingURL=server.d.ts.map