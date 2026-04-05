/**
 * Trust Score Accumulation System
 *
 * Builds trust gradients from gate outcomes over time. Sits alongside the
 * CoherenceScheduler (coherence.ts) but tracks a separate dimension:
 * accumulated trust from successful/failed gate evaluations.
 *
 * TrustAccumulator:
 * - Maintains a running trust score per agent (0.0 to 1.0)
 * - Accumulates trust from gate outcomes (allow, deny, warn)
 * - Applies exponential decay toward the initial value when idle
 * - Maps trust scores to privilege tiers (trusted, standard, probation, untrusted)
 *
 * TrustLedger:
 * - Records every trust score change with full context
 * - Supports export/import for persistence
 * - Querying by agent or threshold
 *
 * Trust-based rate limiting:
 * - Adjusts rate limits proportionally to accumulated trust
 *
 * @module @monobrain/guidance/trust
 */
// ============================================================================
// Default Configuration
// ============================================================================
const DEFAULT_TRUST_CONFIG = {
    initialTrust: 0.5,
    allowDelta: 0.01,
    denyDelta: -0.05,
    warnDelta: -0.02,
    decayRate: 0.01,
    decayIntervalMs: 60_000, // 1 minute
};
// ============================================================================
// Trust Tier Thresholds
// ============================================================================
const TIER_THRESHOLDS = {
    trusted: 0.8,
    standard: 0.5,
    probation: 0.3,
};
// ============================================================================
// Rate Limit Multipliers
// ============================================================================
const RATE_LIMIT_MULTIPLIERS = {
    trusted: 2.0,
    standard: 1.0,
    probation: 0.5,
    untrusted: 0.1,
};
// ============================================================================
// Trust Accumulator
// ============================================================================
/**
 * Maintains running trust scores per agent, accumulates trust from gate
 * outcomes, applies time-based exponential decay, and maps scores to
 * privilege tiers.
 */
export class TrustAccumulator {
    config;
    agents = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_TRUST_CONFIG, ...config };
    }
    /**
     * Record a gate outcome for an agent, adjusting their trust score.
     *
     * - 'allow' increases trust by `allowDelta`
     * - 'deny' decreases trust by `denyDelta` (negative value)
     * - 'warn' decreases trust by `warnDelta` (negative value)
     *
     * Before applying the delta, exponential decay is applied if enough
     * time has elapsed since the last update.
     *
     * Returns the trust record describing the change.
     */
    recordOutcome(agentId, outcome, reason) {
        const state = this.getOrCreateState(agentId);
        const now = Date.now();
        // Apply decay before the outcome delta
        this.applyDecay(state, now);
        const previousScore = state.score;
        // Determine delta from outcome
        let delta;
        switch (outcome) {
            case 'allow':
                delta = this.config.allowDelta;
                break;
            case 'deny':
                delta = this.config.denyDelta;
                break;
            case 'warn':
                delta = this.config.warnDelta;
                break;
        }
        // Apply delta and clamp to [0, 1]
        state.score = clamp(state.score + delta, 0, 1);
        state.totalEvents++;
        state.lastUpdated = now;
        return {
            agentId,
            previousScore,
            newScore: state.score,
            delta,
            reason,
            timestamp: now,
            gateDecision: outcome,
        };
    }
    /**
     * Get the current trust score for an agent.
     * Returns the configured initial trust if the agent is unknown.
     */
    getScore(agentId) {
        const state = this.agents.get(agentId);
        if (!state)
            return this.config.initialTrust;
        // Apply decay before reading (non-mutating copy for read)
        const now = Date.now();
        const elapsed = now - state.lastUpdated;
        if (elapsed >= this.config.decayIntervalMs) {
            this.applyDecay(state, now);
        }
        return state.score;
    }
    /**
     * Determine the privilege tier for an agent based on their trust score.
     *
     * - >= 0.8: 'trusted' (expanded privileges, higher rate limits)
     * - >= 0.5: 'standard' (normal operation)
     * - >= 0.3: 'probation' (restricted tools, lower rate limits)
     * - < 0.3: 'untrusted' (read-only, must earn trust back)
     */
    getTier(agentId) {
        const score = this.getScore(agentId);
        return scoreToTier(score);
    }
    /**
     * Get a full snapshot of an agent's trust state.
     */
    getSnapshot(agentId) {
        const score = this.getScore(agentId);
        const state = this.agents.get(agentId);
        return {
            agentId,
            score,
            tier: scoreToTier(score),
            totalEvents: state?.totalEvents ?? 0,
            lastUpdated: state?.lastUpdated ?? 0,
        };
    }
    /**
     * Get snapshots for all tracked agents.
     */
    getAllSnapshots() {
        const snapshots = [];
        for (const agentId of this.agents.keys()) {
            snapshots.push(this.getSnapshot(agentId));
        }
        return snapshots;
    }
    /**
     * Get a trust-adjusted rate limit for an agent.
     *
     * Multipliers by tier:
     * - trusted: 2x base limit
     * - standard: 1x base limit
     * - probation: 0.5x base limit
     * - untrusted: 0.1x base limit
     */
    getTrustBasedRateLimit(agentId, baseLimit) {
        const tier = this.getTier(agentId);
        return Math.floor(baseLimit * RATE_LIMIT_MULTIPLIERS[tier]);
    }
    /**
     * Manually set an agent's trust score (e.g., from persistence restore).
     * Clamps to [0, 1].
     */
    setScore(agentId, score) {
        const state = this.getOrCreateState(agentId);
        state.score = clamp(score, 0, 1);
        state.lastUpdated = Date.now();
    }
    /**
     * Remove an agent from tracking entirely.
     */
    removeAgent(agentId) {
        return this.agents.delete(agentId);
    }
    /**
     * Get the number of tracked agents.
     */
    get agentCount() {
        return this.agents.size;
    }
    /**
     * Get all tracked agent IDs.
     */
    getAgentIds() {
        return [...this.agents.keys()];
    }
    /**
     * Get the current configuration.
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Reset all tracked agents.
     */
    clear() {
        this.agents.clear();
    }
    // ===== Private =====
    getOrCreateState(agentId) {
        let state = this.agents.get(agentId);
        if (!state) {
            state = {
                score: this.config.initialTrust,
                totalEvents: 0,
                lastUpdated: Date.now(),
            };
            this.agents.set(agentId, state);
        }
        return state;
    }
    /**
     * Apply exponential decay toward the initial trust value.
     *
     * The decay formula moves the score toward `initialTrust` by a fraction
     * proportional to the number of decay intervals elapsed:
     *
     *   score = score + (initialTrust - score) * (1 - (1 - decayRate)^intervals)
     *
     * This ensures idle agents gradually return to the baseline.
     */
    applyDecay(state, now) {
        const elapsed = now - state.lastUpdated;
        if (elapsed < this.config.decayIntervalMs)
            return;
        const intervals = Math.floor(elapsed / this.config.decayIntervalMs);
        if (intervals <= 0)
            return;
        const retainFactor = Math.pow(1 - this.config.decayRate, intervals);
        const target = this.config.initialTrust;
        // Exponential interpolation toward target
        state.score = target + (state.score - target) * retainFactor;
        state.lastUpdated = now;
    }
}
// ============================================================================
// Trust Ledger
// ============================================================================
/**
 * Records all trust score changes with full context. Supports persistence
 * via export/import and querying by agent or threshold.
 */
export class TrustLedger {
    records = [];
    static MAX_RECORDS = 10_000;
    /**
     * Append a trust record to the ledger.
     */
    record(entry) {
        this.records.push(entry);
        // Evict oldest records when the ledger exceeds capacity
        if (this.records.length > TrustLedger.MAX_RECORDS) {
            this.records = this.records.slice(-TrustLedger.MAX_RECORDS);
        }
    }
    /**
     * Get the full trust history for a specific agent, ordered chronologically.
     */
    getHistoryForAgent(agentId) {
        return this.records.filter(r => r.agentId === agentId);
    }
    /**
     * Get all agents whose most recent score is below the given threshold.
     * Returns one record per agent (the most recent).
     */
    getAgentsBelowThreshold(threshold) {
        const latestByAgent = new Map();
        for (const record of this.records) {
            const existing = latestByAgent.get(record.agentId);
            if (!existing || record.timestamp > existing.timestamp) {
                latestByAgent.set(record.agentId, record);
            }
        }
        const result = [];
        for (const record of latestByAgent.values()) {
            if (record.newScore < threshold) {
                result.push(record);
            }
        }
        return result;
    }
    /**
     * Get all agents whose most recent score is at or above the given threshold.
     * Returns one record per agent (the most recent).
     */
    getAgentsAboveThreshold(threshold) {
        const latestByAgent = new Map();
        for (const record of this.records) {
            const existing = latestByAgent.get(record.agentId);
            if (!existing || record.timestamp > existing.timestamp) {
                latestByAgent.set(record.agentId, record);
            }
        }
        const result = [];
        for (const record of latestByAgent.values()) {
            if (record.newScore >= threshold) {
                result.push(record);
            }
        }
        return result;
    }
    /**
     * Get records within a time range.
     */
    getRecordsInRange(startMs, endMs) {
        return this.records.filter(r => r.timestamp >= startMs && r.timestamp <= endMs);
    }
    /**
     * Get the most recent N records.
     */
    getRecentRecords(count) {
        return this.records.slice(-count);
    }
    /**
     * Get the total number of records.
     */
    get recordCount() {
        return this.records.length;
    }
    /**
     * Export all records for persistence.
     */
    exportRecords() {
        return [...this.records];
    }
    /**
     * Import records from persistence. Appends to existing records.
     */
    importRecords(records) {
        this.records.push(...records);
        // Re-enforce capacity limit after import
        if (this.records.length > TrustLedger.MAX_RECORDS) {
            this.records = this.records.slice(-TrustLedger.MAX_RECORDS);
        }
    }
    /**
     * Clear all records.
     */
    clear() {
        this.records = [];
    }
}
// ============================================================================
// Integrated Trust System
// ============================================================================
/**
 * Combines TrustAccumulator and TrustLedger into a single coordinated
 * system. Gate outcomes are accumulated and automatically logged.
 */
export class TrustSystem {
    accumulator;
    ledger;
    constructor(config = {}) {
        this.accumulator = new TrustAccumulator(config);
        this.ledger = new TrustLedger();
    }
    /**
     * Record a gate outcome, update the accumulator, and log to the ledger.
     */
    recordOutcome(agentId, outcome, reason) {
        const record = this.accumulator.recordOutcome(agentId, outcome, reason);
        this.ledger.record(record);
        return record;
    }
    /**
     * Get the current trust score for an agent.
     */
    getScore(agentId) {
        return this.accumulator.getScore(agentId);
    }
    /**
     * Get the current privilege tier for an agent.
     */
    getTier(agentId) {
        return this.accumulator.getTier(agentId);
    }
    /**
     * Get a trust-adjusted rate limit for an agent.
     */
    getTrustBasedRateLimit(agentId, baseLimit) {
        return this.accumulator.getTrustBasedRateLimit(agentId, baseLimit);
    }
    /**
     * Get a full snapshot of an agent's trust state.
     */
    getSnapshot(agentId) {
        return this.accumulator.getSnapshot(agentId);
    }
    /**
     * Get snapshots for all tracked agents.
     */
    getAllSnapshots() {
        return this.accumulator.getAllSnapshots();
    }
}
// ============================================================================
// Standalone Rate Limit Helper
// ============================================================================
/**
 * Compute a trust-adjusted rate limit from a score and base limit.
 *
 * This is a stateless utility for cases where you have a trust score
 * but no TrustAccumulator instance.
 *
 * Multipliers by tier:
 * - trusted (>= 0.8): 2x
 * - standard (>= 0.5): 1x
 * - probation (>= 0.3): 0.5x
 * - untrusted (< 0.3): 0.1x
 */
export function getTrustBasedRateLimit(score, baseLimit) {
    const tier = scoreToTier(score);
    return Math.floor(baseLimit * RATE_LIMIT_MULTIPLIERS[tier]);
}
// ============================================================================
// Factory Functions
// ============================================================================
/**
 * Create a TrustAccumulator with optional configuration.
 */
export function createTrustAccumulator(config) {
    return new TrustAccumulator(config);
}
/**
 * Create an empty TrustLedger.
 */
export function createTrustLedger() {
    return new TrustLedger();
}
/**
 * Create a coordinated TrustSystem (accumulator + ledger).
 */
export function createTrustSystem(config) {
    return new TrustSystem(config);
}
// ============================================================================
// Helpers
// ============================================================================
/**
 * Map a trust score to a privilege tier.
 */
function scoreToTier(score) {
    if (score >= TIER_THRESHOLDS.trusted)
        return 'trusted';
    if (score >= TIER_THRESHOLDS.standard)
        return 'standard';
    if (score >= TIER_THRESHOLDS.probation)
        return 'probation';
    return 'untrusted';
}
/**
 * Clamp a number to the range [min, max].
 */
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
//# sourceMappingURL=trust.js.map