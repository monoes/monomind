/**
 * CLI Main Entry Point
 * Modernized CLI for Monomind
 *
 * github.com/nokhodian/monomind
 */
export declare const VERSION: string;
export interface CLIOptions {
    name?: string;
    description?: string;
    version?: string;
    interactive?: boolean;
}
/**
 * CLI Application
 */
export declare class CLI {
    private name;
    private description;
    private version;
    private parser;
    private output;
    private interactive;
    constructor(options?: CLIOptions);
    /**
     * Run the CLI with given arguments
     */
    run(args?: string[]): Promise<void>;
    /**
     * Show main help
     */
    private showHelp;
    /**
     * Show command-specific help
     */
    private showCommandHelp;
    /**
     * Show version
     */
    private showVersion;
    /**
     * Check for updates on startup (non-blocking)
     * Shows notification if updates are available
     */
    private checkForUpdatesOnStartup;
    /**
     * Load configuration file
     */
    private loadConfig;
    /**
     * Initialize optional subsystems at startup (non-blocking, all failures are silent).
     * Wires TierManager, ObservabilityBus + TraceCollector, and SwarmCheckpointer
     * so that packages/@monoes/* actually contribute to the live runtime.
     */
    private initSubsystems;
    /**
     * Handle errors
     */
    private handleError;
}
export * from './types.js';
export { CommandParser, commandParser } from './parser.js';
export { OutputFormatter, output, Progress, Spinner, type VerbosityLevel } from './output.js';
export * from './prompt.js';
export * from './commands/index.js';
export { MCPServerManager, createMCPServerManager, getServerManager, startMCPServer, stopMCPServer, getMCPServerStatus, type MCPServerOptions, type MCPServerStatus, } from './mcp-server.js';
export { initializeMemoryDatabase, generateEmbedding, generateBatchEmbeddings, storeEntry, searchEntries, getHNSWIndex, addToHNSWIndex, searchHNSWIndex, getHNSWStatus, clearHNSWIndex, quantizeInt8, dequantizeInt8, quantizedCosineSim, getQuantizationStats, batchCosineSim, softmaxAttention, topKIndices, flashAttentionSearch, type MemoryInitResult, } from './memory/memory-initializer.js';
export { initializeIntelligence, recordStep, recordTrajectory, findSimilarPatterns, getIntelligenceStats, getSonaCoordinator, getReasoningBank, clearIntelligence, benchmarkAdaptation, endTrajectoryWithVerdict, distillLearning, getAllPatterns, getPatternsByType, flushPatterns, deletePattern, clearAllPatterns, getNeuralDataDir, getPersistenceStatus, type SonaConfig, type TrajectoryStep, type Pattern, type IntelligenceStats, } from './memory/intelligence.js';
export { EWCConsolidator, getEWCConsolidator, resetEWCConsolidator, consolidatePatterns, recordPatternOutcome, getEWCStats, type PatternWeights, type EWCConfig, type ConsolidationResult, type EWCStats, } from './memory/ewc-consolidation.js';
export { SONAOptimizer, getSONAOptimizer, resetSONAOptimizer, processTrajectory, getSuggestion, getSONAStats, type TrajectoryOutcome, type LearnedPattern, type RoutingSuggestion, type SONAStats, } from './memory/sona-optimizer.js';
export { ErrorHandler, withErrorHandling, } from './production/error-handler.js';
export type { ErrorContext, ErrorHandlerConfig, } from './production/error-handler.js';
export { RateLimiter, createRateLimiter, } from './production/rate-limiter.js';
export type { RateLimiterConfig, RateLimitResult, } from './production/rate-limiter.js';
export { withRetry, makeRetryable, } from './production/retry.js';
export type { RetryConfig, RetryResult, RetryStrategy, } from './production/retry.js';
export { CircuitBreaker, getCircuitBreaker, getAllCircuitStats, resetAllCircuits, } from './production/circuit-breaker.js';
export type { CircuitBreakerConfig, CircuitState, } from './production/circuit-breaker.js';
export { MonitoringHooks, createMonitor, getMonitor, } from './production/monitoring.js';
export type { MonitorConfig, MetricEvent, HealthStatus, PerformanceMetrics, } from './production/monitoring.js';
export default CLI;
//# sourceMappingURL=index.d.ts.map