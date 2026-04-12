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
// ============================================================================
// Default Configurations
// ============================================================================
const DEFAULT_THRESHOLDS = {
    readOnlyThreshold: 0.3,
    warningThreshold: 0.5,
    healthyThreshold: 0.7,
    privilegeEscalationThreshold: 0.9,
};
const DEFAULT_ECONOMIC_CONFIG = {
    tokenLimit: 1_000_000,
    toolCallLimit: 10_000,
    storageLimit: 1_073_741_824, // 1 GiB
    timeLimit: 3_600_000, // 1 hour
    costPerToken: 0.000003, // $3 per million tokens
    costPerToolCall: 0.0001,
    costLimit: 10, // $10 USD
};
/**
 * Computes coherence scores from run metrics and events, determines privilege
 * levels, and provides recommendations when drift is detected.
 */
export class CoherenceScheduler {
    thresholds;
    windowSize;
    checkIntervalMs;
    scoreHistory = [];
    static MAX_HISTORY = 100;
    constructor(config = {}) {
        this.thresholds = { ...DEFAULT_THRESHOLDS, ...config.thresholds };
        this.windowSize = config.windowSize ?? 20;
        this.checkIntervalMs = config.checkIntervalMs ?? 30_000;
    }
    /**
     * Compute a coherence score from optimization metrics and recent events.
     *
     * Components:
     * - violationComponent: 1 - (violationRate / 10) clamped to [0, 1]
     * - reworkComponent: 1 - (reworkLines / 100) clamped to [0, 1]
     * - driftComponent: intent consistency (fewer unique intents relative to window = higher)
     * - overall: weighted average (0.4 * violation + 0.3 * rework + 0.3 * drift)
     */
    computeCoherence(metrics, recentEvents) {
        const window = recentEvents.slice(-this.windowSize);
        const windowLen = window.length;
        // Violation component: fewer violations per 10 tasks = better
        const violationComponent = clamp(1 - metrics.violationRate / 10, 0, 1);
        // Rework component: fewer rework lines on average = better
        const reworkComponent = clamp(1 - metrics.reworkLines / 100, 0, 1);
        // Drift component: consistent intents = better
        // A single unique intent across N events means perfect consistency
        let driftComponent;
        if (windowLen === 0) {
            driftComponent = 1; // No events, assume no drift
        }
        else {
            const uniqueIntents = new Set(window.map(e => e.intent)).size;
            // 1 unique intent / N events = score 1; N unique / N events = score approaches 0
            driftComponent = clamp(1 - (uniqueIntents - 1) / Math.max(windowLen - 1, 1), 0, 1);
        }
        const overall = 0.4 * violationComponent +
            0.3 * reworkComponent +
            0.3 * driftComponent;
        const score = {
            overall,
            violationComponent,
            reworkComponent,
            driftComponent,
            timestamp: Date.now(),
            windowSize: windowLen,
        };
        this.scoreHistory.push(score);
        if (this.scoreHistory.length > CoherenceScheduler.MAX_HISTORY) {
            this.scoreHistory.shift();
        }
        return score;
    }
    /**
     * Determine the privilege level from a coherence score.
     *
     * - overall >= healthyThreshold (0.7): 'full'
     * - overall >= warningThreshold (0.5): 'restricted'
     * - overall >= readOnlyThreshold (0.3): 'read-only'
     * - below readOnlyThreshold: 'suspended'
     */
    getPrivilegeLevel(score) {
        if (score.overall >= this.thresholds.healthyThreshold) {
            return 'full';
        }
        if (score.overall >= this.thresholds.warningThreshold) {
            return 'restricted';
        }
        if (score.overall >= this.thresholds.readOnlyThreshold) {
            return 'read-only';
        }
        return 'suspended';
    }
    /**
     * Return the last 100 coherence scores (most recent last).
     */
    getScoreHistory() {
        return [...this.scoreHistory];
    }
    /**
     * Whether the score indicates healthy coherence.
     */
    isHealthy(score) {
        return score.overall >= this.thresholds.healthyThreshold;
    }
    /**
     * Whether the score indicates drift (below warning threshold).
     */
    isDrifting(score) {
        return score.overall < this.thresholds.warningThreshold;
    }
    /**
     * Whether the score warrants restricting agent actions.
     */
    shouldRestrict(score) {
        return score.overall < this.thresholds.warningThreshold;
    }
    /**
     * Produce a human-readable recommendation based on the coherence score.
     */
    getRecommendation(score) {
        const level = this.getPrivilegeLevel(score);
        const parts = [];
        switch (level) {
            case 'full':
                parts.push(`Coherence is healthy at ${(score.overall * 100).toFixed(1)}%.`);
                if (score.overall >= this.thresholds.privilegeEscalationThreshold) {
                    parts.push('Privilege escalation is permitted.');
                }
                break;
            case 'restricted':
                parts.push(`Coherence is degraded at ${(score.overall * 100).toFixed(1)}%. Agent privileges are restricted.`);
                break;
            case 'read-only':
                parts.push(`Coherence is critically low at ${(score.overall * 100).toFixed(1)}%. Agent is limited to read-only operations.`);
                break;
            case 'suspended':
                parts.push(`Coherence has collapsed to ${(score.overall * 100).toFixed(1)}%. Agent operations are suspended.`);
                break;
        }
        // Add component-specific advice
        if (score.violationComponent < 0.5) {
            parts.push(`High violation rate detected (component: ${(score.violationComponent * 100).toFixed(0)}%). Review and strengthen enforcement gates.`);
        }
        if (score.reworkComponent < 0.5) {
            parts.push(`Excessive rework detected (component: ${(score.reworkComponent * 100).toFixed(0)}%). Consider more prescriptive guidance or smaller task scopes.`);
        }
        if (score.driftComponent < 0.5) {
            parts.push(`Intent drift detected (component: ${(score.driftComponent * 100).toFixed(0)}%). Agent is switching between too many task types. Focus on a single objective.`);
        }
        return parts.join(' ');
    }
    /**
     * Get the configured check interval in milliseconds.
     */
    get interval() {
        return this.checkIntervalMs;
    }
    /**
     * Get the configured thresholds.
     */
    getThresholds() {
        return { ...this.thresholds };
    }
}
/**
 * Tracks resource consumption (tokens, tool calls, storage, time, cost)
 * and enforces budget limits with alerts.
 */
export class EconomicGovernor {
    config;
    tokensUsed = 0;
    toolCallsUsed = 0;
    storageUsed = 0;
    toolCallLog = [];
    startTime;
    periodStart;
    static ALERT_THRESHOLDS = [0.75, 0.9, 0.95, 1.0];
    constructor(config = {}) {
        this.config = {
            tokenLimit: config.tokenLimit ?? DEFAULT_ECONOMIC_CONFIG.tokenLimit,
            toolCallLimit: config.toolCallLimit ?? DEFAULT_ECONOMIC_CONFIG.toolCallLimit,
            storageLimit: config.storageLimit ?? DEFAULT_ECONOMIC_CONFIG.storageLimit,
            timeLimit: config.timeLimit ?? DEFAULT_ECONOMIC_CONFIG.timeLimit,
            costPerToken: config.costPerToken ?? DEFAULT_ECONOMIC_CONFIG.costPerToken,
            costPerToolCall: config.costPerToolCall ?? DEFAULT_ECONOMIC_CONFIG.costPerToolCall,
            costLimit: config.costLimit ?? DEFAULT_ECONOMIC_CONFIG.costLimit,
        };
        this.startTime = Date.now();
        this.periodStart = Date.now();
    }
    /**
     * Record token consumption.
     */
    recordTokenUsage(count) {
        this.tokensUsed += count;
    }
    /**
     * Record a tool call with its name and duration.
     */
    recordToolCall(toolName, durationMs) {
        this.toolCallsUsed++;
        this.toolCallLog.push({
            toolName,
            durationMs,
            timestamp: Date.now(),
        });
    }
    /**
     * Record storage usage in bytes.
     */
    recordStorageUsage(bytes) {
        this.storageUsed += bytes;
    }
    /**
     * Check whether current usage is within budget limits.
     * Returns a summary with alerts for any limits that are near or exceeded.
     */
    checkBudget() {
        const usage = this.getUsageSummary();
        const alerts = [];
        // Check each dimension against alert thresholds
        const dimensions = [
            { name: 'tokens', percentage: usage.tokens.percentage },
            { name: 'tool calls', percentage: usage.toolCalls.percentage },
            { name: 'storage', percentage: usage.storage.percentage },
            { name: 'time', percentage: usage.time.percentage },
            { name: 'cost', percentage: usage.cost.percentage },
        ];
        let withinBudget = true;
        for (const dim of dimensions) {
            if (dim.percentage >= 100) {
                alerts.push(`BUDGET EXCEEDED: ${dim.name} at ${dim.percentage.toFixed(1)}% of limit`);
                withinBudget = false;
            }
            else if (dim.percentage >= 95) {
                alerts.push(`CRITICAL: ${dim.name} at ${dim.percentage.toFixed(1)}% of limit`);
            }
            else if (dim.percentage >= 90) {
                alerts.push(`WARNING: ${dim.name} at ${dim.percentage.toFixed(1)}% of limit`);
            }
            else if (dim.percentage >= 75) {
                alerts.push(`NOTICE: ${dim.name} at ${dim.percentage.toFixed(1)}% of limit`);
            }
        }
        return { withinBudget, usage, alerts };
    }
    /**
     * Get a full usage summary across all tracked dimensions.
     */
    getUsageSummary() {
        const elapsedMs = Date.now() - this.periodStart;
        const costEstimate = this.getCostEstimate();
        return {
            tokens: {
                used: this.tokensUsed,
                limit: this.config.tokenLimit,
                percentage: safePercentage(this.tokensUsed, this.config.tokenLimit),
            },
            toolCalls: {
                used: this.toolCallsUsed,
                limit: this.config.toolCallLimit,
                percentage: safePercentage(this.toolCallsUsed, this.config.toolCallLimit),
            },
            storage: {
                usedBytes: this.storageUsed,
                limitBytes: this.config.storageLimit,
                percentage: safePercentage(this.storageUsed, this.config.storageLimit),
            },
            time: {
                usedMs: elapsedMs,
                limitMs: this.config.timeLimit,
                percentage: safePercentage(elapsedMs, this.config.timeLimit),
            },
            cost: {
                totalUsd: costEstimate.totalCost,
                limitUsd: this.config.costLimit,
                percentage: safePercentage(costEstimate.totalCost, this.config.costLimit),
            },
        };
    }
    /**
     * Reset all counters for a new billing/tracking period.
     */
    resetPeriod() {
        this.tokensUsed = 0;
        this.toolCallsUsed = 0;
        this.storageUsed = 0;
        this.toolCallLog.length = 0;
        this.periodStart = Date.now();
    }
    /**
     * Estimate remaining capacity before hitting limits.
     */
    estimateRemainingCapacity() {
        const elapsedMs = Date.now() - this.periodStart;
        return {
            tokensRemaining: Math.max(0, this.config.tokenLimit - this.tokensUsed),
            callsRemaining: Math.max(0, this.config.toolCallLimit - this.toolCallsUsed),
            timeRemainingMs: Math.max(0, this.config.timeLimit - elapsedMs),
        };
    }
    /**
     * Compute a cost estimate with a breakdown by category.
     */
    getCostEstimate() {
        const tokenCost = this.tokensUsed * this.config.costPerToken;
        const toolCallCost = this.toolCallsUsed * this.config.costPerToolCall;
        const breakdown = {
            tokens: tokenCost,
            toolCalls: toolCallCost,
        };
        return {
            totalCost: tokenCost + toolCallCost,
            breakdown,
        };
    }
    /**
     * Get the raw tool call log.
     */
    getToolCallLog() {
        return this.toolCallLog;
    }
}
// ============================================================================
// Factory Functions
// ============================================================================
/**
 * Create a CoherenceScheduler with optional configuration.
 */
export function createCoherenceScheduler(config) {
    return new CoherenceScheduler(config);
}
/**
 * Create an EconomicGovernor with optional configuration.
 */
export function createEconomicGovernor(config) {
    return new EconomicGovernor(config);
}
// ============================================================================
// Helpers
// ============================================================================
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function safePercentage(used, limit) {
    if (limit <= 0)
        return 0;
    return (used / limit) * 100;
}
//# sourceMappingURL=coherence.js.map