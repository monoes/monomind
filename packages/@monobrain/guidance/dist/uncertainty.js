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
import { randomUUID } from 'node:crypto';
// ============================================================================
// Default Configuration
// ============================================================================
const DEFAULT_UNCERTAINTY_CONFIG = {
    defaultConfidence: 0.7,
    decayRatePerHour: 0.01,
    contestedThreshold: 0.3,
    refutedThreshold: 0.7,
    minConfidenceForAction: 0.3,
};
const SERIALIZATION_VERSION = 1;
// ============================================================================
// UncertaintyLedger
// ============================================================================
/**
 * A ledger that tracks beliefs with explicit uncertainty metadata.
 *
 * Every belief carries a confidence interval, supporting and opposing evidence,
 * inference chain links, and time-based decay. The ledger recomputes confidence
 * from evidence weights and propagates uncertainty through inference chains.
 */
export class UncertaintyLedger {
    config;
    beliefs = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_UNCERTAINTY_CONFIG, ...config };
    }
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
    assert(claim, namespace, evidence, confidence) {
        const now = Date.now();
        const point = confidence?.point ?? this.config.defaultConfidence;
        const lower = confidence?.lower ?? clamp(point - 0.1, 0, 1);
        const upper = confidence?.upper ?? clamp(point + 0.1, 0, 1);
        const supporting = evidence.filter(e => e.supports);
        const opposing = evidence.filter(e => !e.supports);
        const belief = {
            id: randomUUID(),
            claim,
            namespace,
            confidence: {
                lower: clamp(lower, 0, 1),
                point: clamp(point, 0, 1),
                upper: clamp(upper, 0, 1),
            },
            status: 'unknown',
            evidence: supporting,
            opposingEvidence: opposing,
            inferredFrom: [],
            firstAsserted: now,
            lastUpdated: now,
            decayRate: this.config.decayRatePerHour,
            tags: [],
        };
        // Compute initial status from evidence
        belief.status = this.deriveStatus(belief);
        this.beliefs.set(belief.id, belief);
        return belief;
    }
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
    addEvidence(beliefId, evidence) {
        const belief = this.beliefs.get(beliefId);
        if (!belief)
            return undefined;
        if (evidence.supports) {
            belief.evidence.push(evidence);
        }
        else {
            belief.opposingEvidence.push(evidence);
        }
        this.recomputeConfidence(belief);
        belief.status = this.deriveStatus(belief);
        belief.lastUpdated = Date.now();
        return belief;
    }
    /**
     * Retrieve a belief by its ID.
     *
     * @param id - The belief ID
     * @returns The belief, or undefined if not found
     */
    getBelief(id) {
        return this.beliefs.get(id);
    }
    /**
     * Query beliefs with optional filters.
     *
     * All specified filters are ANDed together. Returns beliefs ordered
     * by lastUpdated descending.
     *
     * @param opts - Filter criteria
     * @returns Matching beliefs
     */
    query(opts = {}) {
        const results = [];
        for (const belief of this.beliefs.values()) {
            if (opts.namespace !== undefined && belief.namespace !== opts.namespace) {
                continue;
            }
            if (opts.status !== undefined && belief.status !== opts.status) {
                continue;
            }
            if (opts.minConfidence !== undefined && belief.confidence.point < opts.minConfidence) {
                continue;
            }
            if (opts.tags !== undefined && opts.tags.length > 0) {
                const beliefTags = new Set(belief.tags);
                if (!opts.tags.every(t => beliefTags.has(t))) {
                    continue;
                }
            }
            results.push(belief);
        }
        return results.sort((a, b) => b.lastUpdated - a.lastUpdated);
    }
    /**
     * Get all beliefs with status 'contested'.
     *
     * @returns Array of contested beliefs
     */
    getContested() {
        return this.query({ status: 'contested' });
    }
    /**
     * Get all beliefs with status 'uncertain' or 'contested'.
     *
     * @returns Array of unresolved beliefs
     */
    getUnresolved() {
        const results = [];
        for (const belief of this.beliefs.values()) {
            if (belief.status === 'uncertain' || belief.status === 'contested') {
                results.push(belief);
            }
        }
        return results.sort((a, b) => b.lastUpdated - a.lastUpdated);
    }
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
    computeConfidence(beliefId) {
        const belief = this.beliefs.get(beliefId);
        if (!belief)
            return undefined;
        this.recomputeConfidence(belief);
        belief.status = this.deriveStatus(belief);
        belief.lastUpdated = Date.now();
        return { ...belief.confidence };
    }
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
    propagateUncertainty(parentId, childId, inferenceWeight) {
        const parent = this.beliefs.get(parentId);
        const child = this.beliefs.get(childId);
        if (!parent || !child)
            return undefined;
        const weight = clamp(inferenceWeight, 0, 1);
        // Record the inference relationship
        if (!child.inferredFrom.includes(parentId)) {
            child.inferredFrom.push(parentId);
        }
        // Bound child confidence by parent * weight
        const maxPoint = parent.confidence.point * weight;
        const maxUpper = parent.confidence.upper * weight;
        const maxLower = parent.confidence.lower * weight;
        child.confidence.point = Math.min(child.confidence.point, maxPoint);
        child.confidence.upper = Math.min(child.confidence.upper, maxUpper);
        child.confidence.lower = Math.min(child.confidence.lower, maxLower);
        // Ensure ordering invariant: lower <= point <= upper
        child.confidence.lower = Math.min(child.confidence.lower, child.confidence.point);
        child.confidence.upper = Math.max(child.confidence.upper, child.confidence.point);
        child.status = this.deriveStatus(child);
        child.lastUpdated = Date.now();
        return child;
    }
    /**
     * Apply time-based decay to all beliefs.
     *
     * Each belief's confidence.point is reduced by its decayRate for every
     * hour elapsed since lastUpdated. The lower and upper bounds shrink
     * proportionally. Status is updated if confidence drops below thresholds.
     *
     * @param currentTime - The reference time for computing elapsed decay (defaults to now)
     */
    decayAll(currentTime) {
        const now = currentTime ?? Date.now();
        for (const belief of this.beliefs.values()) {
            const elapsedMs = now - belief.lastUpdated;
            if (elapsedMs <= 0)
                continue;
            const elapsedHours = elapsedMs / 3_600_000;
            const decay = belief.decayRate * elapsedHours;
            if (decay <= 0)
                continue;
            // Apply decay to point estimate
            belief.confidence.point = clamp(belief.confidence.point - decay, 0, 1);
            // Shrink bounds proportionally
            belief.confidence.lower = clamp(belief.confidence.lower - decay, 0, belief.confidence.point);
            belief.confidence.upper = clamp(belief.confidence.upper - decay * 0.5, belief.confidence.point, 1);
            belief.status = this.deriveStatus(belief);
            belief.lastUpdated = now;
        }
    }
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
    resolve(beliefId, status, reason) {
        const belief = this.beliefs.get(beliefId);
        if (!belief)
            return undefined;
        belief.status = status;
        belief.lastUpdated = Date.now();
        // When confirming, set confidence to high; when refuting, set to low
        if (status === 'confirmed') {
            belief.confidence.point = clamp(Math.max(belief.confidence.point, 0.95), 0, 1);
            belief.confidence.upper = 1.0;
            belief.confidence.lower = clamp(Math.max(belief.confidence.lower, 0.9), 0, 1);
        }
        else if (status === 'refuted') {
            belief.confidence.point = clamp(Math.min(belief.confidence.point, 0.05), 0, 1);
            belief.confidence.lower = 0.0;
            belief.confidence.upper = clamp(Math.min(belief.confidence.upper, 0.1), 0, 1);
        }
        // Record the resolution as evidence
        const resolutionEvidence = {
            sourceId: `resolution:${beliefId}:${Date.now()}`,
            sourceType: 'human-input',
            supports: status === 'confirmed',
            weight: 1.0,
            timestamp: Date.now(),
        };
        if (resolutionEvidence.supports) {
            belief.evidence.push(resolutionEvidence);
        }
        else {
            belief.opposingEvidence.push(resolutionEvidence);
        }
        // Store reason in the evidence sourceId for traceability
        // (reason is captured via the resolution evidence pattern)
        return belief;
    }
    /**
     * Check whether a belief's confidence meets the minimum threshold for action.
     *
     * @param beliefId - The belief to check
     * @returns true if confidence.point >= minConfidenceForAction, false otherwise
     */
    isActionable(beliefId) {
        const belief = this.beliefs.get(beliefId);
        if (!belief)
            return false;
        return belief.confidence.point >= this.config.minConfidenceForAction;
    }
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
    getConfidenceChain(beliefId) {
        const root = this.beliefs.get(beliefId);
        if (!root)
            return [];
        const result = [];
        const visited = new Set();
        const traverse = (id, depth) => {
            if (visited.has(id))
                return;
            visited.add(id);
            const belief = this.beliefs.get(id);
            if (!belief)
                return;
            result.push({ belief, depth });
            for (const parentId of belief.inferredFrom) {
                traverse(parentId, depth + 1);
            }
        };
        traverse(beliefId, 0);
        return result.sort((a, b) => a.depth - b.depth);
    }
    /**
     * Export all beliefs for persistence.
     *
     * @returns Serialized ledger data suitable for JSON.stringify
     */
    exportBeliefs() {
        return {
            beliefs: Array.from(this.beliefs.values()).map(b => ({ ...b })),
            createdAt: new Date().toISOString(),
            version: SERIALIZATION_VERSION,
        };
    }
    /**
     * Import previously exported beliefs, replacing all current contents.
     *
     * @param data - Serialized ledger data
     * @throws If the version is unsupported
     */
    importBeliefs(data) {
        if (data.version !== SERIALIZATION_VERSION) {
            throw new Error(`Unsupported uncertainty ledger version: ${data.version} (expected ${SERIALIZATION_VERSION})`);
        }
        this.beliefs.clear();
        for (const belief of data.beliefs) {
            this.beliefs.set(belief.id, { ...belief });
        }
    }
    /**
     * Get the number of tracked beliefs.
     */
    get size() {
        return this.beliefs.size;
    }
    /**
     * Get the current configuration.
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Remove all beliefs from the ledger.
     */
    clear() {
        this.beliefs.clear();
    }
    // ===== Private =====
    /**
     * Recompute the confidence interval for a belief from its evidence arrays.
     *
     * Point estimate is derived from the balance of supporting vs opposing
     * evidence weights. Bounds reflect the spread of evidence.
     */
    recomputeConfidence(belief) {
        const allEvidence = [...belief.evidence, ...belief.opposingEvidence];
        if (allEvidence.length === 0) {
            // No evidence: keep current confidence (from assertion)
            return;
        }
        let supportingWeight = 0;
        let opposingWeight = 0;
        for (const e of belief.evidence) {
            supportingWeight += e.weight;
        }
        for (const e of belief.opposingEvidence) {
            opposingWeight += e.weight;
        }
        const totalWeight = supportingWeight + opposingWeight;
        if (totalWeight === 0) {
            // All evidence has zero weight: no update
            return;
        }
        // Point estimate: proportion of supporting weight
        const point = supportingWeight / totalWeight;
        // Compute spread from evidence count (more evidence = tighter interval)
        const evidenceCount = allEvidence.length;
        const spread = Math.max(0.02, 0.3 / Math.sqrt(evidenceCount));
        belief.confidence = {
            lower: clamp(point - spread, 0, 1),
            point: clamp(point, 0, 1),
            upper: clamp(point + spread, 0, 1),
        };
    }
    /**
     * Derive the belief status from its current confidence and evidence ratios.
     */
    deriveStatus(belief) {
        const allEvidence = [...belief.evidence, ...belief.opposingEvidence];
        if (allEvidence.length === 0) {
            return 'unknown';
        }
        // If already manually resolved to confirmed or refuted, preserve it
        if (belief.status === 'confirmed' || belief.status === 'refuted') {
            // Only preserve if there's resolution evidence (weight 1.0 human-input)
            const hasResolution = allEvidence.some(e => e.sourceType === 'human-input' && e.weight === 1.0);
            if (hasResolution)
                return belief.status;
        }
        let supportingWeight = 0;
        let opposingWeight = 0;
        for (const e of belief.evidence) {
            supportingWeight += e.weight;
        }
        for (const e of belief.opposingEvidence) {
            opposingWeight += e.weight;
        }
        const totalWeight = supportingWeight + opposingWeight;
        if (totalWeight === 0) {
            return 'unknown';
        }
        const opposingRatio = opposingWeight / totalWeight;
        // Check thresholds from most severe to least
        if (opposingRatio >= this.config.refutedThreshold) {
            return 'refuted';
        }
        if (opposingRatio >= this.config.contestedThreshold) {
            return 'contested';
        }
        // Not contested; determine from confidence level
        if (belief.confidence.point >= 0.8) {
            return 'probable';
        }
        if (belief.confidence.point >= 0.5) {
            return 'uncertain';
        }
        return 'uncertain';
    }
}
// ============================================================================
// UncertaintyAggregator
// ============================================================================
/**
 * Computes aggregate confidence metrics across multiple beliefs.
 *
 * Provides geometric mean, worst-case, best-case, and status checks
 * over sets of beliefs referenced by ID.
 */
export class UncertaintyAggregator {
    ledger;
    constructor(ledger) {
        this.ledger = ledger;
    }
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
    aggregate(beliefIds) {
        const confidences = this.collectConfidences(beliefIds);
        if (confidences.length === 0)
            return 0;
        // Geometric mean via log-space to avoid underflow
        const logSum = confidences.reduce((sum, c) => {
            // Protect against log(0)
            const safe = Math.max(c, 1e-10);
            return sum + Math.log(safe);
        }, 0);
        return Math.exp(logSum / confidences.length);
    }
    /**
     * Return the lowest confidence point among the specified beliefs.
     *
     * @param beliefIds - IDs of beliefs to check
     * @returns The minimum confidence point, or 0 if no valid beliefs
     */
    worstCase(beliefIds) {
        const confidences = this.collectConfidences(beliefIds);
        if (confidences.length === 0)
            return 0;
        return Math.min(...confidences);
    }
    /**
     * Return the highest confidence point among the specified beliefs.
     *
     * @param beliefIds - IDs of beliefs to check
     * @returns The maximum confidence point, or 0 if no valid beliefs
     */
    bestCase(beliefIds) {
        const confidences = this.collectConfidences(beliefIds);
        if (confidences.length === 0)
            return 0;
        return Math.max(...confidences);
    }
    /**
     * Check if any of the specified beliefs is contested.
     *
     * @param beliefIds - IDs of beliefs to check
     * @returns true if at least one belief has status 'contested'
     */
    anyContested(beliefIds) {
        for (const id of beliefIds) {
            const belief = this.ledger.getBelief(id);
            if (belief && belief.status === 'contested')
                return true;
        }
        return false;
    }
    /**
     * Check if all of the specified beliefs are confirmed.
     *
     * @param beliefIds - IDs of beliefs to check
     * @returns true only if every belief exists and has status 'confirmed'
     */
    allConfirmed(beliefIds) {
        if (beliefIds.length === 0)
            return false;
        for (const id of beliefIds) {
            const belief = this.ledger.getBelief(id);
            if (!belief || belief.status !== 'confirmed')
                return false;
        }
        return true;
    }
    // ===== Private =====
    /**
     * Collect the confidence point estimates for all valid belief IDs.
     */
    collectConfidences(beliefIds) {
        const confidences = [];
        for (const id of beliefIds) {
            const belief = this.ledger.getBelief(id);
            if (belief) {
                confidences.push(belief.confidence.point);
            }
        }
        return confidences;
    }
}
// ============================================================================
// Factory Functions
// ============================================================================
/**
 * Create an UncertaintyLedger with optional configuration.
 *
 * @param config - Partial configuration; unspecified values use defaults
 * @returns A fresh UncertaintyLedger
 */
export function createUncertaintyLedger(config) {
    return new UncertaintyLedger(config);
}
/**
 * Create an UncertaintyAggregator backed by the given ledger.
 *
 * @param ledger - The UncertaintyLedger to aggregate over
 * @returns A fresh UncertaintyAggregator
 */
export function createUncertaintyAggregator(ledger) {
    return new UncertaintyAggregator(ledger);
}
// ============================================================================
// Helpers
// ============================================================================
/**
 * Clamp a number to the range [min, max].
 */
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
//# sourceMappingURL=uncertainty.js.map