/**
 * Headless Worker Executor
 * Enables workers to invoke Claude Code in headless mode with configurable sandbox profiles.
 *
 * ADR-020: Headless Worker Integration Architecture
 * - Integrates with CLAUDE_CODE_HEADLESS and CLAUDE_CODE_SANDBOX_MODE environment variables
 * - Provides process pool for concurrent execution
 * - Builds context from file glob patterns
 * - Supports prompt templates and output parsing
 * - Implements timeout and graceful error handling
 *
 * Key Features:
 * - Process pool with configurable maxConcurrent
 * - Context building from file glob patterns with caching
 * - Prompt template system with context injection
 * - Output parsing (text, json, markdown)
 * - Timeout handling with graceful termination
 * - Execution logging for debugging
 * - Event emission for monitoring
 */
import { EventEmitter } from 'events';
import type { WorkerType } from './worker-daemon.js';
/**
 * Headless worker types - workers that use Claude Code AI
 */
export type HeadlessWorkerType = 'audit' | 'optimize' | 'testgaps' | 'document' | 'ultralearn' | 'refactor' | 'deepdive' | 'predict';
/**
 * Local worker types - workers that run locally without AI
 */
export type LocalWorkerType = 'map' | 'consolidate' | 'benchmark' | 'preload';
/**
 * Sandbox mode for headless execution
 */
export type SandboxMode = 'strict' | 'permissive' | 'disabled';
/**
 * Model types for Claude Code
 */
export type ModelType = 'sonnet' | 'opus' | 'haiku';
/**
 * Output format for worker results
 */
export type OutputFormat = 'text' | 'json' | 'markdown';
/**
 * Execution mode for workers
 */
export type ExecutionMode = 'local' | 'headless';
/**
 * Worker priority levels
 */
export type WorkerPriority = 'low' | 'normal' | 'high' | 'critical';
/**
 * Base worker configuration (matching worker-daemon.ts)
 */
export interface WorkerConfig {
    type: WorkerType;
    intervalMs: number;
    priority: WorkerPriority;
    description: string;
    enabled: boolean;
}
/**
 * Headless-specific options
 */
export interface HeadlessOptions {
    /** Prompt template for Claude Code */
    promptTemplate: string;
    /** Sandbox profile: strict, permissive, or disabled */
    sandbox: SandboxMode;
    /** Model to use: sonnet, opus, or haiku */
    model?: ModelType;
    /** Maximum tokens for output */
    maxOutputTokens?: number;
    /** Timeout in milliseconds (overrides default) */
    timeoutMs?: number;
    /** File glob patterns to include as context */
    contextPatterns?: string[];
    /** Output parsing format */
    outputFormat?: OutputFormat;
}
/**
 * Extended worker configuration with headless options
 */
export interface HeadlessWorkerConfig extends WorkerConfig {
    /** Execution mode: local or headless */
    mode: ExecutionMode;
    /** Headless-specific options (required when mode is 'headless') */
    headless?: HeadlessOptions;
}
/**
 * Executor configuration options
 */
export interface HeadlessExecutorConfig {
    /** Maximum concurrent headless processes */
    maxConcurrent?: number;
    /** Default timeout in milliseconds */
    defaultTimeoutMs?: number;
    /** Maximum files to include in context */
    maxContextFiles?: number;
    /** Maximum characters per file in context */
    maxCharsPerFile?: number;
    /** Log directory for execution logs */
    logDir?: string;
    /** Whether to cache context between runs */
    cacheContext?: boolean;
    /** Context cache TTL in milliseconds */
    cacheTtlMs?: number;
}
/**
 * Result from headless execution
 */
export interface HeadlessExecutionResult {
    /** Whether execution completed successfully */
    success: boolean;
    /** Raw output from Claude Code */
    output: string;
    /** Parsed output (if outputFormat is json or markdown) */
    parsedOutput?: unknown;
    /** Execution duration in milliseconds */
    durationMs: number;
    /** Estimated tokens used (if available) */
    tokensUsed?: number;
    /** Model used for execution */
    model: string;
    /** Sandbox mode used */
    sandboxMode: SandboxMode;
    /** Worker type that was executed */
    workerType: HeadlessWorkerType;
    /** Timestamp of execution */
    timestamp: Date;
    /** Error message if execution failed */
    error?: string;
    /** Execution ID for tracking */
    executionId: string;
}
/**
 * Pool status information
 */
export interface PoolStatus {
    activeCount: number;
    queueLength: number;
    maxConcurrent: number;
    activeWorkers: Array<{
        executionId: string;
        workerType: HeadlessWorkerType;
        startTime: Date;
        elapsedMs: number;
    }>;
    queuedWorkers: Array<{
        workerType: HeadlessWorkerType;
        queuedAt: Date;
        waitingMs: number;
    }>;
}
/**
 * Array of headless worker types for runtime checking
 */
export declare const HEADLESS_WORKER_TYPES: HeadlessWorkerType[];
/**
 * Array of local worker types
 */
export declare const LOCAL_WORKER_TYPES: LocalWorkerType[];
/**
 * Default headless worker configurations based on ADR-020
 */
export declare const HEADLESS_WORKER_CONFIGS: Record<HeadlessWorkerType, HeadlessWorkerConfig>;
/**
 * Local worker configurations
 */
export declare const LOCAL_WORKER_CONFIGS: Record<LocalWorkerType, HeadlessWorkerConfig>;
/**
 * Combined worker configurations
 */
export declare const ALL_WORKER_CONFIGS: HeadlessWorkerConfig[];
/**
 * Check if a worker type is a headless worker
 */
export declare function isHeadlessWorker(type: WorkerType): type is HeadlessWorkerType;
/**
 * Check if a worker type is a local worker
 */
export declare function isLocalWorker(type: WorkerType): type is LocalWorkerType;
/**
 * Get model ID from model type
 */
export declare function getModelId(model: ModelType): string;
/**
 * Get worker configuration by type
 */
export declare function getWorkerConfig(type: WorkerType): HeadlessWorkerConfig | undefined;
/**
 * HeadlessWorkerExecutor - Executes workers using Claude Code in headless mode
 *
 * Features:
 * - Process pool with configurable concurrency limit
 * - Pending queue for overflow requests
 * - Context caching with configurable TTL
 * - Execution logging for debugging
 * - Event emission for monitoring
 * - Graceful termination
 */
export declare class HeadlessWorkerExecutor extends EventEmitter {
    private projectRoot;
    private config;
    private processPool;
    private pendingQueue;
    private contextCache;
    private claudeCodeAvailable;
    private claudeCodeAvailableCheckedAt;
    private claudeCodeVersion;
    private activeReservations;
    constructor(projectRoot: string, options?: HeadlessExecutorConfig);
    /**
     * Check if Claude Code CLI is available
     */
    isAvailable(): Promise<boolean>;
    /**
     * Get Claude Code version
     */
    getVersion(): Promise<string | null>;
    /**
     * Execute a headless worker
     */
    execute(workerType: HeadlessWorkerType, configOverrides?: Partial<HeadlessOptions>): Promise<HeadlessExecutionResult>;
    /**
     * Get pool status
     */
    getPoolStatus(): PoolStatus;
    /**
     * Get number of active executions
     */
    getActiveCount(): number;
    /**
     * Cancel a running execution
     */
    cancel(executionId: string): boolean;
    /**
     * Cancel all running executions for a specific worker type.
     * Used by the timeout handler in worker-daemon to avoid killing unrelated workers.
     */
    cancelByType(workerType: string): boolean;
    /**
     * Cancel all running executions
     */
    cancelAll(): number;
    /**
     * Clear context cache
     */
    clearContextCache(): void;
    /**
     * Get worker configuration
     */
    getConfig(workerType: HeadlessWorkerType): HeadlessWorkerConfig | undefined;
    /**
     * Get all headless worker types
     */
    getHeadlessWorkerTypes(): HeadlessWorkerType[];
    /**
     * Get all local worker types
     */
    getLocalWorkerTypes(): LocalWorkerType[];
    /**
     * Ensure log directory exists
     */
    private ensureLogDir;
    /**
     * Internal execution logic
     */
    private executeInternal;
    /**
     * Process the pending queue
     */
    private processQueue;
    /**
     * Build context from file patterns
     */
    private buildContext;
    /**
     * Simple glob implementation for file matching
     */
    private simpleGlob;
    /**
     * Match filename against a simple pattern
     */
    private matchesPattern;
    /**
     * Build full prompt with context
     */
    private buildPrompt;
    /**
     * Execute Claude Code in headless mode
     */
    private executeClaudeCode;
    /**
     * Parse JSON output from Claude Code
     */
    private parseJsonOutput;
    /**
     * Parse markdown output into sections
     */
    private parseMarkdownOutput;
    /**
     * Create an error result
     */
    private createErrorResult;
    /**
     * Log execution details for debugging
     */
    private logExecution;
}
export default HeadlessWorkerExecutor;
//# sourceMappingURL=headless-worker-executor.d.ts.map