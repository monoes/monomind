/**
 * Coherence Scheduler & Economic Governor
 *
 * Detects drift in agent behavior and enforces resource budgets.
 *
 * CoherenceScheduler:
 * - Computes a coherence score from violation rate, rework, and intent drift
 * - Maps scores to privilege levels (full, restricted, read-only, suspended)
 * - Tracks score history and provides human-readable recommendations
 *
 * EconomicGovernor:
 * - Tracks token usage, tool calls, storage, and time
 * - Checks budgets and emits alerts when thresholds are crossed
 * - Estimates remaining capacity and costs
 *
 * @module @monobrain/guidance/coherence
 */
import type { RunEvent, OptimizationMetrics } from './types.js';
/**
 * Coherence score computed from recent run metrics and events
 */
export interface CoherenceScore {
    /** Overall coherence (0-1, 1 = perfectly coherent) */
    overall: number;
    /** Violation component (0-1, lower violations = higher score) */
    violationComponent: number;
    /** Rework component (0-1, lower rework = higher score) */
    reworkComponent: number;
    /** Drift component (0-1, consistent intents = higher score) */
    driftComponent: number;
    /** Timestamp when this score was computed */
    timestamp: number;
    /** Number of events evaluated in the window */
    windowSize: number;
}
/**
 * Thresholds for privilege level determination
 */
export interface CoherenceThresholds {
    /** Below this overall score the agent is restricted to read-only */
    readOnlyThreshold: number;
    /** Below this overall score warnings are emitted */
    warningThreshold: number;
    /** Above this overall score the agent has full privileges */
    healthyThreshold: number;
    /** Above this overall score privilege escalation is allowed */
    privilegeEscalationThreshold: number;
}
/**
 * Privilege level derived from a coherence score
 */
export type PrivilegeLevel = 'full' | 'restricted' | 'read-only' | 'suspended';
/**
 * Budget usage breakdown across all tracked dimensions
 */
export interface BudgetUsage {
    tokens: {
        used: number;
        limit: number;
        percentage: number;
    };
    toolCalls: {
        used: number;
        limit: number;
        percentage: number;
    };
    storage: {
        usedBytes: number;
        limitBytes: number;
        percentage: number;
    };
    time: {
        usedMs: number;
        limitMs: number;
        percentage: number;
    };
    cost: {
        totalUsd: number;
        limitUsd: number;
        percentage: number;
    };
}
export interface CoherenceSchedulerConfig {
    thresholds?: Partial<CoherenceThresholds>;
    windowSize?: number;
    checkIntervalMs?: number;
}
/**
 * Computes coherence scores from run metrics and events, determines privilege
 * levels, and provides recommendations when drift is detected.
 */
export declare class CoherenceScheduler {
    private readonly thresholds;
    private readonly windowSize;
    private readonly checkIntervalMs;
    private readonly scoreHistory;
    private static readonly MAX_HISTORY;
    constructor(config?: CoherenceSchedulerConfig);
    /**
     * Compute a coherence score from optimization metrics and recent events.
     *
     * Components:
     * - violationComponent: 1 - (violationRate / 10) clamped to [0, 1]
     * - reworkComponent: 1 - (reworkLines / 100) clamped to [0, 1]
     * - driftComponent: intent consistency (fewer unique intents relative to window = higher)
     * - overall: weighted average (0.4 * violation + 0.3 * rework + 0.3 * drift)
     */
    computeCoherence(metrics: OptimizationMetrics, recentEvents: RunEvent[]): CoherenceScore;
    /**
     * Determine the privilege level from a coherence score.
     *
     * - overall >= healthyThreshold (0.7): 'full'
     * - overall >= warningThreshold (0.5): 'restricted'
     * - overall >= readOnlyThreshold (0.3): 'read-only'
     * - below readOnlyThreshold: 'suspended'
     */
    getPrivilegeLevel(score: CoherenceScore): PrivilegeLevel;
    /**
     * Return the last 100 coherence scores (most recent last).
     */
    getScoreHistory(): CoherenceScore[];
    /**
     * Whether the score indicates healthy coherence.
     */
    isHealthy(score: CoherenceScore): boolean;
    /**
     * Whether the score indicates drift (below warning threshold).
     */
    isDrifting(score: CoherenceScore): boolean;
    /**
     * Whether the score warrants restricting agent actions.
     */
    shouldRestrict(score: CoherenceScore): boolean;
    /**
     * Produce a human-readable recommendation based on the coherence score.
     */
    getRecommendation(score: CoherenceScore): string;
    /**
     * Get the configured check interval in milliseconds.
     */
    get interval(): number;
    /**
     * Get the configured thresholds.
     */
    getThresholds(): CoherenceThresholds;
}
export interface EconomicGovernorConfig {
    tokenLimit?: number;
    toolCallLimit?: number;
    storageLimit?: number;
    timeLimit?: number;
    costPerToken?: number;
    costPerToolCall?: number;
    costLimit?: number;
}
interface ToolCallRecord {
    toolName: string;
    durationMs: number;
    timestamp: number;
}
/**
 * Tracks resource consumption (tokens, tool calls, storage, time, cost)
 * and enforces budget limits with alerts.
 */
export declare class EconomicGovernor {
    private readonly config;
    private tokensUsed;
    private toolCallsUsed;
    private storageUsed;
    private readonly toolCallLog;
    private readonly startTime;
    private periodStart;
    private static readonly ALERT_THRESHOLDS;
    constructor(config?: EconomicGovernorConfig);
    /**
     * Record token consumption.
     */
    recordTokenUsage(count: number): void;
    /**
     * Record a tool call with its name and duration.
     */
    recordToolCall(toolName: string, durationMs: number): void;
    /**
     * Record storage usage in bytes.
     */
    recordStorageUsage(bytes: number): void;
    /**
     * Check whether current usage is within budget limits.
     * Returns a summary with alerts for any limits that are near or exceeded.
     */
    checkBudget(): {
        withinBudget: boolean;
        usage: BudgetUsage;
        alerts: string[];
    };
    /**
     * Get a full usage summary across all tracked dimensions.
     */
    getUsageSummary(): BudgetUsage;
    /**
     * Reset all counters for a new billing/tracking period.
     */
    resetPeriod(): void;
    /**
     * Estimate remaining capacity before hitting limits.
     */
    estimateRemainingCapacity(): {
        tokensRemaining: number;
        callsRemaining: number;
        timeRemainingMs: number;
    };
    /**
     * Compute a cost estimate with a breakdown by category.
     */
    getCostEstimate(): {
        totalCost: number;
        breakdown: Record<string, number>;
    };
    /**
     * Get the raw tool call log.
     */
    getToolCallLog(): ReadonlyArray<ToolCallRecord>;
}
/**
 * Create a CoherenceScheduler with optional configuration.
 */
export declare function createCoherenceScheduler(config?: CoherenceSchedulerConfig): CoherenceScheduler;
/**
 * Create an EconomicGovernor with optional configuration.
 */
export declare function createEconomicGovernor(config?: EconomicGovernorConfig): EconomicGovernor;
export {};
//# sourceMappingURL=coherence.d.ts.map