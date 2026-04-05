/**
 * Uncertainty as a First-Class State
 *
 * Probabilistic belief tracking with confidence intervals, evidence counts,
 * and opposing evidence pointers. Uncertainty is preserved, not eliminated.
 *
 * Every piece of knowledge in the system carries explicit uncertainty metadata.
 * Claims can be partial, unresolved, or contested. Confidence propagates
 * through inference chains and decays over time.
 *
 * UncertaintyLedger:
 * - Asserts beliefs with explicit confidence intervals and evidence
 * - Recomputes confidence from weighted supporting/opposing evidence
 * - Propagates uncertainty through inference chains (child bounded by parent)
 * - Applies time-based decay to all beliefs
 * - Queries by namespace, status, confidence, and tags
 * - Traces full inference chains back to root beliefs
 *
 * UncertaintyAggregator:
 * - Computes aggregate confidence across multiple beliefs (geometric mean)
 * - Worst-case and best-case confidence queries
 * - Contested and confirmed status checks across belief sets
 *
 * @module @monobrain/guidance/uncertainty
 */
/**
 * Lifecycle status of a belief.
 *
 * - confirmed: evidence strongly supports; manually or automatically resolved
 * - probable: confidence is high but not confirmed
 * - uncertain: insufficient evidence to decide
 * - contested: significant opposing evidence exists
 * - refuted: evidence strongly opposes the claim
 * - unknown: no evidence has been provided yet
 */
export type BeliefStatus = 'confirmed' | 'probable' | 'uncertain' | 'contested' | 'refuted' | 'unknown';
/**
 * A bounded confidence estimate with lower, point, and upper values.
 * All values are in the range [0.0, 1.0].
 */
export interface ConfidenceInterval {
    /** Lower bound of the confidence interval (0.0 - 1.0) */
    lower: number;
    /** Best point estimate of confidence (0.0 - 1.0) */
    point: number;
    /** Upper bound of the confidence interval (0.0 - 1.0) */
    upper: number;
}
/**
 * A pointer to a piece of evidence that supports or opposes a belief.
 */
export interface EvidencePointer {
    /** Unique identifier of the evidence source */
    sourceId: string;
    /** Classification of the evidence origin */
    sourceType: 'memory-read' | 'tool-output' | 'truth-anchor' | 'inference' | 'human-input' | 'agent-report';
    /** true = supporting evidence, false = opposing evidence */
    supports: boolean;
    /** Strength of this evidence (0.0 - 1.0) */
    weight: number;
    /** Unix timestamp (ms) when this evidence was recorded */
    timestamp: number;
}
/**
 * A tracked belief with full uncertainty metadata.
 */
export interface Belief {
    /** Unique belief identifier (UUID) */
    id: string;
    /** The claim this belief represents */
    claim: string;
    /** Namespace for grouping related beliefs */
    namespace: string;
    /** Bounded confidence estimate */
    confidence: ConfidenceInterval;
    /** Current lifecycle status */
    status: BeliefStatus;
    /** Evidence that supports the claim */
    evidence: EvidencePointer[];
    /** Evidence that opposes the claim */
    opposingEvidence: EvidencePointer[];
    /** Parent belief IDs this belief was inferred from */
    inferredFrom: string[];
    /** Unix timestamp (ms) when this belief was first asserted */
    firstAsserted: number;
    /** Unix timestamp (ms) of the most recent update */
    lastUpdated: number;
    /** Per-belief decay rate (confidence points lost per hour) */
    decayRate: number;
    /** Searchable tags */
    tags: string[];
}
/**
 * Configuration for the UncertaintyLedger.
 */
export interface UncertaintyConfig {
    /** Default point estimate for new beliefs (0.0 - 1.0) */
    defaultConfidence: number;
    /** Default confidence decay rate per hour */
    decayRatePerHour: number;
    /** Opposing/total evidence ratio threshold to mark a belief contested */
    contestedThreshold: number;
    /** Opposing/total evidence ratio threshold to mark a belief refuted */
    refutedThreshold: number;
    /** Minimum confidence.point required for an action; below this requires confirmation */
    minConfidenceForAction: number;
}
/**
 * Query options for filtering beliefs.
 */
export interface BeliefQueryOptions {
    /** Filter by namespace */
    namespace?: string;
    /** Filter by status */
    status?: BeliefStatus;
    /** Only include beliefs with confidence.point >= this value */
    minConfidence?: number;
    /** Only include beliefs that have all specified tags */
    tags?: string[];
}
/**
 * A node in a confidence inference chain.
 */
export interface ConfidenceChainNode {
    /** The belief at this node */
    belief: Belief;
    /** Depth in the inference chain (0 = the queried belief) */
    depth: number;
}
/**
 * Serializable ledger representation for export/import.
 */
export interface SerializedUncertaintyLedger {
    beliefs: Belief[];
    createdAt: string;
    version: number;
}
/**
 * A ledger that tracks beliefs with explicit uncertainty metadata.
 *
 * Every belief carries a confidence interval, supporting and opposing evidence,
 * inference chain links, and time-based decay. The ledger recomputes confidence
 * from evidence weights and propagates uncertainty through inference chains.
 */
export declare class UncertaintyLedger {
    private readonly config;
    private readonly beliefs;
    constructor(config?: Partial<UncertaintyConfig>);
    /**
     * Assert a new belief in the ledger.
     *
     * Creates a belief with the given claim, namespace, and initial evidence.
     * If no confidence is provided, the default confidence is used to build
     * the initial confidence interval.
     *
     * @param claim - The claim this belief represents
     * @param namespace - Namespace for grouping
     * @param evidence - Initial evidence pointers
     * @param confidence - Optional explicit confidence interval
     * @returns The newly created Belief
     */
    assert(claim: string, namespace: string, evidence: EvidencePointer[], confidence?: Partial<ConfidenceInterval>): Belief;
    /**
     * Add a piece of evidence to an existing belief.
     *
     * Appends the evidence to the appropriate list (supporting or opposing),
     * then recomputes the belief's confidence and status.
     *
     * @param beliefId - The belief to update
     * @param evidence - The new evidence pointer
     * @returns The updated belief, or undefined if not found
     */
    addEvidence(beliefId: string, evidence: EvidencePointer): Belief | undefined;
    /**
     * Retrieve a belief by its ID.
     *
     * @param id - The belief ID
     * @returns The belief, or undefined if not found
     */
    getBelief(id: string): Belief | undefined;
    /**
     * Query beliefs with optional filters.
     *
     * All specified filters are ANDed together. Returns beliefs ordered
     * by lastUpdated descending.
     *
     * @param opts - Filter criteria
     * @returns Matching beliefs
     */
    query(opts?: BeliefQueryOptions): Belief[];
    /**
     * Get all beliefs with status 'contested'.
     *
     * @returns Array of contested beliefs
     */
    getContested(): Belief[];
    /**
     * Get all beliefs with status 'uncertain' or 'contested'.
     *
     * @returns Array of unresolved beliefs
     */
    getUnresolved(): Belief[];
    /**
     * Recompute the confidence interval for a belief from all evidence.
     *
     * The point estimate is a weighted average: total supporting weight minus
     * total opposing weight, normalized to [0, 1]. The interval bounds are
     * derived from the spread of evidence weights.
     *
     * @param beliefId - The belief to recompute
     * @returns The updated confidence interval, or undefined if not found
     */
    computeConfidence(beliefId: string): ConfidenceInterval | undefined;
    /**
     * Propagate uncertainty from a parent belief to a child belief.
     *
     * The child's confidence is bounded by the parent's confidence multiplied
     * by the inference weight. This ensures that downstream beliefs cannot
     * be more confident than their sources warrant.
     *
     * @param parentId - The parent belief ID
     * @param childId - The child belief ID
     * @param inferenceWeight - How strongly the parent supports the child (0.0 - 1.0)
     * @returns The updated child belief, or undefined if either belief is not found
     */
    propagateUncertainty(parentId: string, childId: string, inferenceWeight: number): Belief | undefined;
    /**
     * Apply time-based decay to all beliefs.
     *
     * Each belief's confidence.point is reduced by its decayRate for every
     * hour elapsed since lastUpdated. The lower and upper bounds shrink
     * proportionally. Status is updated if confidence drops below thresholds.
     *
     * @param currentTime - The reference time for computing elapsed decay (defaults to now)
     */
    decayAll(currentTime?: number): void;
    /**
     * Manually resolve a belief to a definitive status.
     *
     * This overrides the computed status. Typically used for 'confirmed' or
     * 'refuted' after human review or authoritative evidence.
     *
     * @param beliefId - The belief to resolve
     * @param status - The new status to assign
     * @param reason - Human-readable reason for the resolution
     * @returns The updated belief, or undefined if not found
     */
    resolve(beliefId: string, status: BeliefStatus, reason: string): Belief | undefined;
    /**
     * Check whether a belief's confidence meets the minimum threshold for action.
     *
     * @param beliefId - The belief to check
     * @returns true if confidence.point >= minConfidenceForAction, false otherwise
     */
    isActionable(beliefId: string): boolean;
    /**
     * Trace the full inference chain from a belief back to its root beliefs.
     *
     * Returns an array of { belief, depth } nodes, starting with the queried
     * belief at depth 0, then its parents at depth 1, their parents at depth 2,
     * and so on. Handles cycles by tracking visited IDs.
     *
     * @param beliefId - The belief whose chain to trace
     * @returns Array of chain nodes ordered by depth, or empty if not found
     */
    getConfidenceChain(beliefId: string): ConfidenceChainNode[];
    /**
     * Export all beliefs for persistence.
     *
     * @returns Serialized ledger data suitable for JSON.stringify
     */
    exportBeliefs(): SerializedUncertaintyLedger;
    /**
     * Import previously exported beliefs, replacing all current contents.
     *
     * @param data - Serialized ledger data
     * @throws If the version is unsupported
     */
    importBeliefs(data: SerializedUncertaintyLedger): void;
    /**
     * Get the number of tracked beliefs.
     */
    get size(): number;
    /**
     * Get the current configuration.
     */
    getConfig(): UncertaintyConfig;
    /**
     * Remove all beliefs from the ledger.
     */
    clear(): void;
    /**
     * Recompute the confidence interval for a belief from its evidence arrays.
     *
     * Point estimate is derived from the balance of supporting vs opposing
     * evidence weights. Bounds reflect the spread of evidence.
     */
    private recomputeConfidence;
    /**
     * Derive the belief status from its current confidence and evidence ratios.
     */
    private deriveStatus;
}
/**
 * Computes aggregate confidence metrics across multiple beliefs.
 *
 * Provides geometric mean, worst-case, best-case, and status checks
 * over sets of beliefs referenced by ID.
 */
export declare class UncertaintyAggregator {
    private readonly ledger;
    constructor(ledger: UncertaintyLedger);
    /**
     * Compute the aggregate confidence across multiple beliefs using
     * the geometric mean of their point estimates.
     *
     * The geometric mean penalizes any single low-confidence belief more
     * heavily than an arithmetic mean, making it appropriate for combining
     * independent confidence estimates.
     *
     * @param beliefIds - IDs of beliefs to aggregate
     * @returns Geometric mean of confidence points, or 0 if no valid beliefs
     */
    aggregate(beliefIds: string[]): number;
    /**
     * Return the lowest confidence point among the specified beliefs.
     *
     * @param beliefIds - IDs of beliefs to check
     * @returns The minimum confidence point, or 0 if no valid beliefs
     */
    worstCase(beliefIds: string[]): number;
    /**
     * Return the highest confidence point among the specified beliefs.
     *
     * @param beliefIds - IDs of beliefs to check
     * @returns The maximum confidence point, or 0 if no valid beliefs
     */
    bestCase(beliefIds: string[]): number;
    /**
     * Check if any of the specified beliefs is contested.
     *
     * @param beliefIds - IDs of beliefs to check
     * @returns true if at least one belief has status 'contested'
     */
    anyContested(beliefIds: string[]): boolean;
    /**
     * Check if all of the specified beliefs are confirmed.
     *
     * @param beliefIds - IDs of beliefs to check
     * @returns true only if every belief exists and has status 'confirmed'
     */
    allConfirmed(beliefIds: string[]): boolean;
    /**
     * Collect the confidence point estimates for all valid belief IDs.
     */
    private collectConfidences;
}
/**
 * Create an UncertaintyLedger with optional configuration.
 *
 * @param config - Partial configuration; unspecified values use defaults
 * @returns A fresh UncertaintyLedger
 */
export declare function createUncertaintyLedger(config?: Partial<UncertaintyConfig>): UncertaintyLedger;
/**
 * Create an UncertaintyAggregator backed by the given ledger.
 *
 * @param ledger - The UncertaintyLedger to aggregate over
 * @returns A fresh UncertaintyAggregator
 */
export declare function createUncertaintyAggregator(ledger: UncertaintyLedger): UncertaintyAggregator;
//# sourceMappingURL=uncertainty.d.ts.map