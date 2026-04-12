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
/**
 * The kind of change being proposed.
 */
export type ChangeProposalKind = 'rule-modify' | 'rule-add' | 'rule-remove' | 'rule-promote' | 'policy-update' | 'tool-config' | 'budget-adjust';
/**
 * Lifecycle status of a change proposal.
 */
export type ProposalStatus = 'draft' | 'signed' | 'simulating' | 'compared' | 'staged' | 'promoted' | 'rolled-back' | 'rejected';
/**
 * Risk assessment attached to a proposal.
 */
export interface RiskAssessment {
    level: 'low' | 'medium' | 'high';
    factors: string[];
}
/**
 * A signed change proposal describing a modification to the guidance system.
 */
export interface ChangeProposal {
    /** Unique identifier (UUID) */
    proposalId: string;
    /** What kind of change this is */
    kind: ChangeProposalKind;
    /** Short human-readable title */
    title: string;
    /** Longer description of the change */
    description: string;
    /** Agent or human ID that authored the proposal */
    author: string;
    /** Dot-path or identifier of what is being changed */
    targetPath: string;
    /** Before/after snapshot of the change */
    diff: {
        before: unknown;
        after: unknown;
    };
    /** Why this change is being proposed */
    rationale: string;
    /** Risk assessment for the change */
    riskAssessment: RiskAssessment;
    /** HMAC-SHA256 signature of the proposal content */
    signature: string;
    /** Epoch ms when the proposal was created */
    createdAt: number;
    /** Current lifecycle status */
    status: ProposalStatus;
}
/**
 * A single decision point where baseline and candidate diverged.
 */
export interface DecisionDiff {
    /** Sequence number in the trace */
    seq: number;
    /** What the baseline decided */
    baseline: unknown;
    /** What the candidate decided */
    candidate: unknown;
    /** How severe the divergence is */
    severity: 'low' | 'medium' | 'high';
}
/**
 * Result of simulating a proposal against golden traces.
 */
export interface SimulationResult {
    /** Proposal that was simulated */
    proposalId: string;
    /** Hash of the trace produced by baseline config */
    baselineTraceHash: string;
    /** Hash of the trace produced by candidate config */
    candidateTraceHash: string;
    /** 0-1 score: 0 = identical, 1 = completely different */
    divergenceScore: number;
    /** Individual decision points where behaviour diverged */
    decisionDiffs: DecisionDiff[];
    /** Side-by-side metric comparison */
    metricsComparison: {
        baseline: Record<string, number>;
        candidate: Record<string, number>;
    };
    /** Whether the simulation passed acceptance criteria */
    passed: boolean;
    /** Human-readable reason for the verdict */
    reason: string;
}
/**
 * A single stage in a staged rollout.
 */
export interface RolloutStage {
    /** Stage name (e.g. 'canary', 'partial', 'full') */
    name: string;
    /** Percentage of traffic/agents this stage covers (0-100) */
    percentage: number;
    /** How long this stage should run before advancing (ms) */
    durationMs: number;
    /** Observed metrics during this stage */
    metrics: Record<string, number>;
    /** Maximum acceptable divergence before auto-rollback */
    divergenceThreshold: number;
    /** null = not evaluated yet, true = passed, false = failed */
    passed: boolean | null;
    /** Epoch ms when the stage started (null if not started) */
    startedAt: number | null;
    /** Epoch ms when the stage completed (null if not completed) */
    completedAt: number | null;
}
/**
 * A staged rollout plan for a change proposal.
 */
export interface StagedRollout {
    /** Unique rollout identifier */
    rolloutId: string;
    /** The proposal being rolled out */
    proposalId: string;
    /** Ordered stages (canary -> partial -> full) */
    stages: RolloutStage[];
    /** Index of the current stage (0-based) */
    currentStage: number;
    /** Overall rollout status */
    status: 'in-progress' | 'completed' | 'rolled-back';
    /** Epoch ms when the rollout started */
    startedAt: number;
    /** Epoch ms when the rollout completed (null if still running) */
    completedAt: number | null;
}
/**
 * History entry combining proposal, optional simulation, optional rollout,
 * and final outcome.
 */
export interface EvolutionHistoryEntry {
    proposal: ChangeProposal;
    simulation?: SimulationResult;
    rollout?: StagedRollout;
    outcome: ProposalStatus;
}
/**
 * Evaluator function for simulation: given a golden trace and a config variant,
 * produce a trace hash and metrics.
 */
export type TraceEvaluator = (trace: unknown, config: 'baseline' | 'candidate') => {
    traceHash: string;
    metrics: Record<string, number>;
    decisions: unknown[];
};
export interface EvolutionPipelineConfig {
    /** HMAC signing key for proposals */
    signingKey?: string;
    /** Maximum divergence score (0-1) to approve a change */
    maxDivergence?: number;
    /** Default rollout stages */
    stages?: RolloutStage[];
}
/**
 * The Evolution Pipeline manages the lifecycle of change proposals through
 * signing, simulation, comparison, staged rollout, and promotion or rollback.
 */
export declare class EvolutionPipeline {
    private readonly signingKey;
    private readonly maxDivergence;
    private readonly defaultStages;
    private proposals;
    private simulations;
    private rollouts;
    constructor(config?: EvolutionPipelineConfig);
    /**
     * Create and sign a new change proposal.
     */
    propose(params: {
        kind: ChangeProposalKind;
        title: string;
        description: string;
        author: string;
        targetPath: string;
        diff: {
            before: unknown;
            after: unknown;
        };
        rationale: string;
        riskAssessment: RiskAssessment;
    }): ChangeProposal;
    /**
     * Run golden traces through both baseline and candidate configs to measure
     * divergence. The evaluator is called once per golden trace per config.
     */
    simulate(proposalId: string, goldenTraces: unknown[], evaluator: TraceEvaluator): SimulationResult;
    /**
     * Compare a simulation result against acceptance criteria.
     *
     * Checks:
     * 1. Divergence is below threshold
     * 2. No regression in key metrics (candidate >= baseline)
     */
    compare(proposalId: string, simulationResult: SimulationResult): {
        approved: boolean;
        reason: string;
    };
    /**
     * Create a staged rollout plan for a proposal.
     */
    stage(proposalId: string): StagedRollout;
    /**
     * Advance to the next rollout stage or auto-rollback.
     *
     * If `stageMetrics.divergence` exceeds the current stage's threshold,
     * the rollout is automatically rolled back.
     */
    advanceStage(rolloutId: string, stageMetrics: Record<string, number>): {
        advanced: boolean;
        rolledBack: boolean;
        reason: string;
    };
    /**
     * Roll back a staged rollout.
     */
    rollback(rolloutId: string, reason: string): void;
    /**
     * Promote a rollout, permanently applying the change.
     */
    promote(rolloutId: string): void;
    /**
     * Get a proposal by ID.
     */
    getProposal(id: string): ChangeProposal | undefined;
    /**
     * Get all proposals, optionally filtered by status.
     */
    getProposals(status?: ProposalStatus): ChangeProposal[];
    /**
     * Get a rollout by ID.
     */
    getRollout(id: string): StagedRollout | undefined;
    /**
     * Get the full evolution history across all proposals.
     */
    getHistory(): EvolutionHistoryEntry[];
    /**
     * Produce an HMAC-SHA256 signature for a proposal.
     *
     * The signature covers every field except `signature` and `status`.
     */
    private signProposal;
    /**
     * Compute a composite hash from an array of trace hashes.
     */
    private hashTraceResults;
    /**
     * Classify how severe a single decision diff is.
     */
    private classifyDiffSeverity;
    /**
     * Compute an overall divergence score (0-1).
     */
    private computeDivergenceScore;
    /**
     * Aggregate an array of metric records into averages.
     */
    private aggregateMetrics;
    /**
     * Find the rollout associated with a proposal.
     */
    private findRolloutByProposal;
}
/**
 * Create an EvolutionPipeline instance.
 */
export declare function createEvolutionPipeline(config?: EvolutionPipelineConfig): EvolutionPipeline;
//# sourceMappingURL=evolution.d.ts.map