/**
 * Optimizer Loop
 *
 * Weekly loop that edits guidance like code:
 * 1. Rank top violations by frequency and cost
 * 2. For the top 3, propose one rule change each
 * 3. Run the fixed task suite with and without the change
 * 4. Promote only if risk does not increase and rework decreases
 * 5. Record the decision in an ADR note
 *
 * Promotion rule: Local rules that win twice become root rules.
 *
 * @module @monobrain/guidance/optimizer
 */
import type { PolicyBundle, ViolationRanking, RuleChange, ABTestResult, OptimizationMetrics, RuleADR } from './types.js';
import type { RunLedger } from './ledger.js';
export interface OptimizerConfig {
    /** Number of top violations to address per cycle */
    topViolationsPerCycle: number;
    /** Minimum events required before optimization */
    minEventsForOptimization: number;
    /** Required improvement threshold for promotion (0-1) */
    improvementThreshold: number;
    /** Maximum risk increase tolerance (0-1) */
    maxRiskIncrease: number;
    /** Number of consecutive wins needed for promotion to root */
    promotionWins: number;
    /** ADR storage path */
    adrPath: string;
}
export declare class OptimizerLoop {
    private config;
    private proposedChanges;
    private testResults;
    private adrs;
    private promotionTracker;
    private lastOptimizationRun;
    constructor(config?: Partial<OptimizerConfig>);
    /**
     * Run a full optimization cycle
     *
     * Steps:
     * 1. Rank violations
     * 2. Propose changes for top N
     * 3. Evaluate changes against baseline
     * 4. Promote winners, record ADRs
     */
    runCycle(ledger: RunLedger, currentBundle: PolicyBundle): Promise<{
        rankings: ViolationRanking[];
        changes: RuleChange[];
        results: ABTestResult[];
        adrs: RuleADR[];
        promoted: string[];
        demoted: string[];
    }>;
    /**
     * Propose rule changes for top violations
     */
    proposeChanges(violations: ViolationRanking[], bundle: PolicyBundle): RuleChange[];
    /**
     * Propose modification to an existing rule
     */
    private proposeRuleModification;
    /**
     * Propose a new rule for unhandled violations
     */
    private proposeNewRule;
    /**
     * Evaluate a proposed change against baseline metrics
     */
    evaluateChange(change: RuleChange, baseline: OptimizationMetrics, ledger: RunLedger): ABTestResult;
    /**
     * Heuristic estimation of how a rule change would affect metrics.
     *
     * This does NOT run a real A/B test against live traffic — it applies
     * fixed multipliers per change-type to the baseline numbers.  The
     * percentages (e.g. 40% for modify, 60% for add) are conservative
     * estimates, not measured values.  Results should be treated as
     * directional guidance, not ground truth.
     */
    private simulateChangeEffect;
    /**
     * Record an ADR for a rule change decision
     */
    private recordADR;
    /**
     * Find a rule in the policy bundle
     */
    private findRule;
    /**
     * Apply promoted changes to a policy bundle
     */
    applyPromotions(bundle: PolicyBundle, promoted: string[], changes: RuleChange[]): PolicyBundle;
    get lastRun(): number | null;
    getADRs(): RuleADR[];
    getProposedChanges(): RuleChange[];
    getTestResults(): ABTestResult[];
    getPromotionTracker(): Map<string, number>;
}
/**
 * Create an optimizer instance
 */
export declare function createOptimizer(config?: Partial<OptimizerConfig>): OptimizerLoop;
//# sourceMappingURL=optimizer.d.ts.map