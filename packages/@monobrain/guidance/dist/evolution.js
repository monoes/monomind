/**
 * Evolution Pipeline
 *
 * Every change to prompts, policies, tools, and code becomes a signed change
 * proposal that goes through simulation, replay comparison, and staged rollout.
 *
 * Pipeline stages:
 * 1. Propose - Create a signed ChangeProposal
 * 2. Simulate - Replay golden traces with baseline vs candidate config
 * 3. Compare  - Approve or reject based on divergence threshold
 * 4. Stage    - Create a staged rollout plan (canary -> partial -> full)
 * 5. Advance  - Progress through stages with metric gates
 * 6. Promote / Rollback - Apply permanently or revert
 *
 * @module @monobrain/guidance/evolution
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
const DEFAULT_MAX_DIVERGENCE = 0.3;
const DEFAULT_STAGES = [
    {
        name: 'canary',
        percentage: 5,
        durationMs: 60_000,
        metrics: {},
        divergenceThreshold: 0.2,
        passed: null,
        startedAt: null,
        completedAt: null,
    },
    {
        name: 'partial',
        percentage: 50,
        durationMs: 300_000,
        metrics: {},
        divergenceThreshold: 0.25,
        passed: null,
        startedAt: null,
        completedAt: null,
    },
    {
        name: 'full',
        percentage: 100,
        durationMs: 600_000,
        metrics: {},
        divergenceThreshold: 0.3,
        passed: null,
        startedAt: null,
        completedAt: null,
    },
];
// ============================================================================
// EvolutionPipeline
// ============================================================================
/**
 * The Evolution Pipeline manages the lifecycle of change proposals through
 * signing, simulation, comparison, staged rollout, and promotion or rollback.
 */
export class EvolutionPipeline {
    signingKey;
    maxDivergence;
    defaultStages;
    proposals = new Map();
    simulations = new Map();
    rollouts = new Map();
    constructor(config = {}) {
        if (!config.signingKey) {
            throw new Error('EvolutionPipeline requires an explicit signingKey — hardcoded defaults are not secure');
        }
        this.signingKey = config.signingKey;
        this.maxDivergence = config.maxDivergence ?? DEFAULT_MAX_DIVERGENCE;
        this.defaultStages = config.stages ?? DEFAULT_STAGES;
    }
    // ==========================================================================
    // Propose
    // ==========================================================================
    /**
     * Create and sign a new change proposal.
     */
    propose(params) {
        const proposalId = randomUUID();
        const createdAt = Date.now();
        const proposal = {
            proposalId,
            kind: params.kind,
            title: params.title,
            description: params.description,
            author: params.author,
            targetPath: params.targetPath,
            diff: params.diff,
            rationale: params.rationale,
            riskAssessment: params.riskAssessment,
            signature: '', // placeholder, signed below
            createdAt,
            status: 'draft',
        };
        proposal.signature = this.signProposal(proposal);
        proposal.status = 'signed';
        this.proposals.set(proposalId, proposal);
        return proposal;
    }
    // ==========================================================================
    // Simulate
    // ==========================================================================
    /**
     * Run golden traces through both baseline and candidate configs to measure
     * divergence. The evaluator is called once per golden trace per config.
     */
    simulate(proposalId, goldenTraces, evaluator) {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) {
            throw new Error(`Proposal not found: ${proposalId}`);
        }
        proposal.status = 'simulating';
        // Evaluate each trace against both configs
        const baselineResults = goldenTraces.map(t => evaluator(t, 'baseline'));
        const candidateResults = goldenTraces.map(t => evaluator(t, 'candidate'));
        // Compute composite trace hashes
        const baselineTraceHash = this.hashTraceResults(baselineResults.map(r => r.traceHash));
        const candidateTraceHash = this.hashTraceResults(candidateResults.map(r => r.traceHash));
        // Compute decision diffs
        const decisionDiffs = [];
        for (let i = 0; i < goldenTraces.length; i++) {
            const bDecisions = baselineResults[i].decisions;
            const cDecisions = candidateResults[i].decisions;
            const maxLen = Math.max(bDecisions.length, cDecisions.length);
            for (let seq = 0; seq < maxLen; seq++) {
                const bVal = seq < bDecisions.length ? bDecisions[seq] : undefined;
                const cVal = seq < cDecisions.length ? cDecisions[seq] : undefined;
                if (JSON.stringify(bVal) !== JSON.stringify(cVal)) {
                    decisionDiffs.push({
                        seq,
                        baseline: bVal,
                        candidate: cVal,
                        severity: this.classifyDiffSeverity(bVal, cVal),
                    });
                }
            }
        }
        // Aggregate metrics
        const baselineMetrics = this.aggregateMetrics(baselineResults.map(r => r.metrics));
        const candidateMetrics = this.aggregateMetrics(candidateResults.map(r => r.metrics));
        // Compute divergence score (0-1)
        const divergenceScore = this.computeDivergenceScore(baselineTraceHash, candidateTraceHash, decisionDiffs, goldenTraces.length);
        const passed = divergenceScore <= this.maxDivergence;
        const reason = passed
            ? `Divergence ${divergenceScore.toFixed(3)} is within threshold ${this.maxDivergence}`
            : `Divergence ${divergenceScore.toFixed(3)} exceeds threshold ${this.maxDivergence}`;
        const result = {
            proposalId,
            baselineTraceHash,
            candidateTraceHash,
            divergenceScore,
            decisionDiffs,
            metricsComparison: {
                baseline: baselineMetrics,
                candidate: candidateMetrics,
            },
            passed,
            reason,
        };
        this.simulations.set(proposalId, result);
        return result;
    }
    // ==========================================================================
    // Compare
    // ==========================================================================
    /**
     * Compare a simulation result against acceptance criteria.
     *
     * Checks:
     * 1. Divergence is below threshold
     * 2. No regression in key metrics (candidate >= baseline)
     */
    compare(proposalId, simulationResult) {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) {
            throw new Error(`Proposal not found: ${proposalId}`);
        }
        // Check divergence threshold
        if (simulationResult.divergenceScore > this.maxDivergence) {
            proposal.status = 'rejected';
            return {
                approved: false,
                reason: `Divergence ${simulationResult.divergenceScore.toFixed(3)} exceeds threshold ${this.maxDivergence}`,
            };
        }
        // Check for metric regressions
        const { baseline, candidate } = simulationResult.metricsComparison;
        const regressions = [];
        for (const key of Object.keys(baseline)) {
            if (candidate[key] !== undefined && candidate[key] < baseline[key]) {
                const pctDrop = ((baseline[key] - candidate[key]) / Math.max(baseline[key], 1)) * 100;
                // Only flag significant regressions (> 5%)
                if (pctDrop > 5) {
                    regressions.push(`${key} regressed by ${pctDrop.toFixed(1)}%`);
                }
            }
        }
        if (regressions.length > 0) {
            proposal.status = 'rejected';
            return {
                approved: false,
                reason: `Metric regressions detected: ${regressions.join('; ')}`,
            };
        }
        proposal.status = 'compared';
        return {
            approved: true,
            reason: `Divergence ${simulationResult.divergenceScore.toFixed(3)} within threshold, no metric regressions`,
        };
    }
    // ==========================================================================
    // Stage
    // ==========================================================================
    /**
     * Create a staged rollout plan for a proposal.
     */
    stage(proposalId) {
        const proposal = this.proposals.get(proposalId);
        if (!proposal) {
            throw new Error(`Proposal not found: ${proposalId}`);
        }
        const now = Date.now();
        // Deep-clone default stages so each rollout has independent state
        const stages = this.defaultStages.map(s => ({
            ...s,
            metrics: { ...s.metrics },
            passed: null,
            startedAt: null,
            completedAt: null,
        }));
        // Start the first stage immediately
        stages[0].startedAt = now;
        const rollout = {
            rolloutId: randomUUID(),
            proposalId,
            stages,
            currentStage: 0,
            status: 'in-progress',
            startedAt: now,
            completedAt: null,
        };
        proposal.status = 'staged';
        this.rollouts.set(rollout.rolloutId, rollout);
        return rollout;
    }
    // ==========================================================================
    // Advance Stage
    // ==========================================================================
    /**
     * Advance to the next rollout stage or auto-rollback.
     *
     * If `stageMetrics.divergence` exceeds the current stage's threshold,
     * the rollout is automatically rolled back.
     */
    advanceStage(rolloutId, stageMetrics) {
        const rollout = this.rollouts.get(rolloutId);
        if (!rollout) {
            throw new Error(`Rollout not found: ${rolloutId}`);
        }
        if (rollout.status !== 'in-progress') {
            return {
                advanced: false,
                rolledBack: false,
                reason: `Rollout is ${rollout.status}, not in-progress`,
            };
        }
        const current = rollout.stages[rollout.currentStage];
        const now = Date.now();
        // Record metrics on the current stage
        current.metrics = { ...stageMetrics };
        // Check divergence against threshold
        const divergence = stageMetrics.divergence ?? 0;
        if (divergence > current.divergenceThreshold) {
            // Auto-rollback
            current.passed = false;
            current.completedAt = now;
            this.rollback(rolloutId, `Stage "${current.name}" divergence ${divergence.toFixed(3)} exceeded threshold ${current.divergenceThreshold}`);
            return {
                advanced: false,
                rolledBack: true,
                reason: `Auto-rollback: divergence ${divergence.toFixed(3)} exceeded threshold ${current.divergenceThreshold} at stage "${current.name}"`,
            };
        }
        // Current stage passed
        current.passed = true;
        current.completedAt = now;
        // Check if there are more stages
        if (rollout.currentStage < rollout.stages.length - 1) {
            rollout.currentStage += 1;
            rollout.stages[rollout.currentStage].startedAt = now;
            return {
                advanced: true,
                rolledBack: false,
                reason: `Advanced to stage "${rollout.stages[rollout.currentStage].name}"`,
            };
        }
        // All stages complete - auto-promote
        rollout.status = 'completed';
        rollout.completedAt = now;
        const proposal = this.proposals.get(rollout.proposalId);
        if (proposal) {
            proposal.status = 'promoted';
        }
        return {
            advanced: true,
            rolledBack: false,
            reason: 'All stages completed successfully; proposal promoted',
        };
    }
    // ==========================================================================
    // Rollback
    // ==========================================================================
    /**
     * Roll back a staged rollout.
     */
    rollback(rolloutId, reason) {
        const rollout = this.rollouts.get(rolloutId);
        if (!rollout) {
            throw new Error(`Rollout not found: ${rolloutId}`);
        }
        rollout.status = 'rolled-back';
        rollout.completedAt = Date.now();
        const proposal = this.proposals.get(rollout.proposalId);
        if (proposal) {
            proposal.status = 'rolled-back';
        }
    }
    // ==========================================================================
    // Promote
    // ==========================================================================
    /**
     * Promote a rollout, permanently applying the change.
     */
    promote(rolloutId) {
        const rollout = this.rollouts.get(rolloutId);
        if (!rollout) {
            throw new Error(`Rollout not found: ${rolloutId}`);
        }
        rollout.status = 'completed';
        rollout.completedAt = Date.now();
        const proposal = this.proposals.get(rollout.proposalId);
        if (proposal) {
            proposal.status = 'promoted';
        }
    }
    // ==========================================================================
    // Queries
    // ==========================================================================
    /**
     * Get a proposal by ID.
     */
    getProposal(id) {
        return this.proposals.get(id);
    }
    /**
     * Get all proposals, optionally filtered by status.
     */
    getProposals(status) {
        const all = Array.from(this.proposals.values());
        if (status === undefined) {
            return all;
        }
        return all.filter(p => p.status === status);
    }
    /**
     * Get a rollout by ID.
     */
    getRollout(id) {
        return this.rollouts.get(id);
    }
    /**
     * Get the full evolution history across all proposals.
     */
    getHistory() {
        return Array.from(this.proposals.values()).map(proposal => ({
            proposal,
            simulation: this.simulations.get(proposal.proposalId),
            rollout: this.findRolloutByProposal(proposal.proposalId),
            outcome: proposal.status,
        }));
    }
    // ==========================================================================
    // Private Helpers
    // ==========================================================================
    /**
     * Produce an HMAC-SHA256 signature for a proposal.
     *
     * The signature covers every field except `signature` and `status`.
     */
    signProposal(proposal) {
        const body = {
            proposalId: proposal.proposalId,
            kind: proposal.kind,
            title: proposal.title,
            description: proposal.description,
            author: proposal.author,
            targetPath: proposal.targetPath,
            diff: proposal.diff,
            rationale: proposal.rationale,
            riskAssessment: proposal.riskAssessment,
            createdAt: proposal.createdAt,
        };
        const payload = JSON.stringify(body);
        return createHmac('sha256', this.signingKey).update(payload).digest('hex');
    }
    /**
     * Compute a composite hash from an array of trace hashes.
     */
    hashTraceResults(traceHashes) {
        const payload = traceHashes.join(':');
        return createHash('sha256').update(payload).digest('hex');
    }
    /**
     * Classify how severe a single decision diff is.
     */
    classifyDiffSeverity(baseline, candidate) {
        // If one is undefined (extra/missing decision), it is high
        if (baseline === undefined || candidate === undefined) {
            return 'high';
        }
        const bStr = JSON.stringify(baseline);
        const cStr = JSON.stringify(candidate);
        // Very different lengths suggest structural changes
        if (Math.abs(bStr.length - cStr.length) > bStr.length * 0.5) {
            return 'high';
        }
        // Moderate difference
        if (bStr.length > 0 && Math.abs(bStr.length - cStr.length) > bStr.length * 0.2) {
            return 'medium';
        }
        return 'low';
    }
    /**
     * Compute an overall divergence score (0-1).
     */
    computeDivergenceScore(baselineHash, candidateHash, diffs, traceCount) {
        // If hashes are identical, divergence = 0
        if (baselineHash === candidateHash) {
            return 0;
        }
        // If there are no golden traces, treat as fully divergent
        if (traceCount === 0) {
            return 1;
        }
        // Weight diffs by severity
        const severityWeights = {
            low: 0.1,
            medium: 0.4,
            high: 1.0,
        };
        const totalWeight = diffs.reduce((sum, d) => sum + (severityWeights[d.severity] ?? 0.5), 0);
        // Normalize: max possible weight is traceCount * maxDecisionsPerTrace
        // Use a heuristic cap to keep score in [0, 1]
        const maxExpected = traceCount * 5; // assume ~5 decisions per trace at max weight
        const raw = totalWeight / Math.max(maxExpected, 1);
        return Math.min(1, Math.max(0, raw));
    }
    /**
     * Aggregate an array of metric records into averages.
     */
    aggregateMetrics(records) {
        if (records.length === 0)
            return {};
        const sums = {};
        const counts = {};
        for (const record of records) {
            for (const [key, value] of Object.entries(record)) {
                sums[key] = (sums[key] ?? 0) + value;
                counts[key] = (counts[key] ?? 0) + 1;
            }
        }
        const result = {};
        for (const key of Object.keys(sums)) {
            result[key] = sums[key] / counts[key];
        }
        return result;
    }
    /**
     * Find the rollout associated with a proposal.
     */
    findRolloutByProposal(proposalId) {
        for (const rollout of this.rollouts.values()) {
            if (rollout.proposalId === proposalId) {
                return rollout;
            }
        }
        return undefined;
    }
}
// ============================================================================
// Factory
// ============================================================================
/**
 * Create an EvolutionPipeline instance.
 */
export function createEvolutionPipeline(config) {
    return new EvolutionPipeline(config);
}
//# sourceMappingURL=evolution.js.map