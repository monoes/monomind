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
/**
 * Privilege tier derived from an agent's accumulated trust score.
 */
export type TrustTier = 'trusted' | 'standard' | 'probation' | 'untrusted';
/**
 * Gate decision outcomes that affect trust accumulation.
 */
export type GateOutcome = 'allow' | 'deny' | 'warn';
/**
 * Configuration for the TrustAccumulator.
 */
export interface TrustConfig {
    /** Starting trust score for new agents (0.0 - 1.0) */
    initialTrust: number;
    /** Trust increase on an 'allow' gate outcome */
    allowDelta: number;
    /** Trust decrease on a 'deny' gate outcome */
    denyDelta: number;
    /** Trust decrease on a 'warn' gate outcome */
    warnDelta: number;
    /** Exponential decay rate (0.0 - 1.0). Higher = faster decay toward initial */
    decayRate: number;
    /** Minimum elapsed time (ms) before decay is applied */
    decayIntervalMs: number;
}
/**
 * A single trust change record in the ledger.
 */
export interface TrustRecord {
    /** Agent whose trust changed */
    agentId: string;
    /** Trust score before the change */
    previousScore: number;
    /** Trust score after the change */
    newScore: number;
    /** The signed delta applied */
    delta: number;
    /** Human-readable reason for the change */
    reason: string;
    /** Unix timestamp (ms) of the change */
    timestamp: number;
    /** Gate decision that triggered this change, if any */
    gateDecision?: GateOutcome;
}
/**
 * Point-in-time snapshot of an agent's trust state.
 */
export interface TrustSnapshot {
    /** Agent identifier */
    agentId: string;
    /** Current trust score */
    score: number;
    /** Current privilege tier */
    tier: TrustTier;
    /** Total gate events processed for this agent */
    totalEvents: number;
    /** Timestamp of the most recent trust change */
    lastUpdated: number;
}
/**
 * Maintains running trust scores per agent, accumulates trust from gate
 * outcomes, applies time-based exponential decay, and maps scores to
 * privilege tiers.
 */
export declare class TrustAccumulator {
    private readonly config;
    private readonly agents;
    constructor(config?: Partial<TrustConfig>);
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
    recordOutcome(agentId: string, outcome: GateOutcome, reason: string): TrustRecord;
    /**
     * Get the current trust score for an agent.
     * Returns the configured initial trust if the agent is unknown.
     */
    getScore(agentId: string): number;
    /**
     * Determine the privilege tier for an agent based on their trust score.
     *
     * - >= 0.8: 'trusted' (expanded privileges, higher rate limits)
     * - >= 0.5: 'standard' (normal operation)
     * - >= 0.3: 'probation' (restricted tools, lower rate limits)
     * - < 0.3: 'untrusted' (read-only, must earn trust back)
     */
    getTier(agentId: string): TrustTier;
    /**
     * Get a full snapshot of an agent's trust state.
     */
    getSnapshot(agentId: string): TrustSnapshot;
    /**
     * Get snapshots for all tracked agents.
     */
    getAllSnapshots(): TrustSnapshot[];
    /**
     * Get a trust-adjusted rate limit for an agent.
     *
     * Multipliers by tier:
     * - trusted: 2x base limit
     * - standard: 1x base limit
     * - probation: 0.5x base limit
     * - untrusted: 0.1x base limit
     */
    getTrustBasedRateLimit(agentId: string, baseLimit: number): number;
    /**
     * Manually set an agent's trust score (e.g., from persistence restore).
     * Clamps to [0, 1].
     */
    setScore(agentId: string, score: number): void;
    /**
     * Remove an agent from tracking entirely.
     */
    removeAgent(agentId: string): boolean;
    /**
     * Get the number of tracked agents.
     */
    get agentCount(): number;
    /**
     * Get all tracked agent IDs.
     */
    getAgentIds(): string[];
    /**
     * Get the current configuration.
     */
    getConfig(): TrustConfig;
    /**
     * Reset all tracked agents.
     */
    clear(): void;
    private getOrCreateState;
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
    private applyDecay;
}
/**
 * Records all trust score changes with full context. Supports persistence
 * via export/import and querying by agent or threshold.
 */
export declare class TrustLedger {
    private records;
    private static readonly MAX_RECORDS;
    /**
     * Append a trust record to the ledger.
     */
    record(entry: TrustRecord): void;
    /**
     * Get the full trust history for a specific agent, ordered chronologically.
     */
    getHistoryForAgent(agentId: string): TrustRecord[];
    /**
     * Get all agents whose most recent score is below the given threshold.
     * Returns one record per agent (the most recent).
     */
    getAgentsBelowThreshold(threshold: number): TrustRecord[];
    /**
     * Get all agents whose most recent score is at or above the given threshold.
     * Returns one record per agent (the most recent).
     */
    getAgentsAboveThreshold(threshold: number): TrustRecord[];
    /**
     * Get records within a time range.
     */
    getRecordsInRange(startMs: number, endMs: number): TrustRecord[];
    /**
     * Get the most recent N records.
     */
    getRecentRecords(count: number): TrustRecord[];
    /**
     * Get the total number of records.
     */
    get recordCount(): number;
    /**
     * Export all records for persistence.
     */
    exportRecords(): TrustRecord[];
    /**
     * Import records from persistence. Appends to existing records.
     */
    importRecords(records: TrustRecord[]): void;
    /**
     * Clear all records.
     */
    clear(): void;
}
/**
 * Combines TrustAccumulator and TrustLedger into a single coordinated
 * system. Gate outcomes are accumulated and automatically logged.
 */
export declare class TrustSystem {
    readonly accumulator: TrustAccumulator;
    readonly ledger: TrustLedger;
    constructor(config?: Partial<TrustConfig>);
    /**
     * Record a gate outcome, update the accumulator, and log to the ledger.
     */
    recordOutcome(agentId: string, outcome: GateOutcome, reason: string): TrustRecord;
    /**
     * Get the current trust score for an agent.
     */
    getScore(agentId: string): number;
    /**
     * Get the current privilege tier for an agent.
     */
    getTier(agentId: string): TrustTier;
    /**
     * Get a trust-adjusted rate limit for an agent.
     */
    getTrustBasedRateLimit(agentId: string, baseLimit: number): number;
    /**
     * Get a full snapshot of an agent's trust state.
     */
    getSnapshot(agentId: string): TrustSnapshot;
    /**
     * Get snapshots for all tracked agents.
     */
    getAllSnapshots(): TrustSnapshot[];
}
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
export declare function getTrustBasedRateLimit(score: number, baseLimit: number): number;
/**
 * Create a TrustAccumulator with optional configuration.
 */
export declare function createTrustAccumulator(config?: Partial<TrustConfig>): TrustAccumulator;
/**
 * Create an empty TrustLedger.
 */
export declare function createTrustLedger(): TrustLedger;
/**
 * Create a coordinated TrustSystem (accumulator + ledger).
 */
export declare function createTrustSystem(config?: Partial<TrustConfig>): TrustSystem;
//# sourceMappingURL=trust.d.ts.map