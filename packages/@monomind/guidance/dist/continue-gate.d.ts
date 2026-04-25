/**
 * Continue Gate - Long-Running Agent Control
 *
 * Evaluates whether a long-running agent should continue its next step.
 * Prevents runaway loops, budget exhaustion, and coherence degradation.
 *
 * Problem:
 * Current gates are tool-centric (PreToolUse, PreCommand, PreEdit).
 * Long-run loops are often internally generated — the agent keeps going
 * without a single obviously bad tool call. There is no gate for "should
 * this agent continue at all?"
 *
 * ContinueGate provides step-level evaluation with:
 * - Hard limits on consecutive steps without checkpoints
 * - Budget acceleration detection via linear regression
 * - Coherence threshold enforcement
 * - Uncertainty threshold enforcement
 * - Rework ratio tracking
 * - Automatic checkpoint intervals
 * - Cooldown between evaluations
 *
 * Decision types:
 * - continue: Agent may proceed to next step
 * - checkpoint: Agent must save state before continuing
 * - throttle: Agent should slow down or wait
 * - pause: Agent should stop and await human review
 * - stop: Agent must halt immediately
 *
 * @module @monobrain/guidance/continue-gate
 */
/**
 * Configuration for the ContinueGate
 */
export interface ContinueGateConfig {
    /** Hard limit on consecutive steps without checkpoint (default 100) */
    maxConsecutiveSteps: number;
    /** Maximum budget slope per step (cost acceleration threshold, default 0.02) */
    maxBudgetSlopePerStep: number;
    /** Minimum coherence score to continue (default 0.4) */
    minCoherenceForContinue: number;
    /** Maximum uncertainty score to continue (default 0.8) */
    maxUncertaintyForContinue: number;
    /** Maximum rework/total steps ratio (default 0.3) */
    maxReworkRatio: number;
    /** Force checkpoint every N steps (default 25) */
    checkpointIntervalSteps: number;
    /** Minimum time between evaluations in milliseconds (default 5000) */
    cooldownMs: number;
}
/**
 * Context for a single step evaluation
 */
export interface StepContext {
    /** Current step number in the run */
    stepNumber: number;
    /** Total tokens consumed so far */
    totalTokensUsed: number;
    /** Total tool calls made so far */
    totalToolCalls: number;
    /** Number of steps that redid previous work */
    reworkCount: number;
    /** Coherence score from CoherenceScheduler (0-1) */
    coherenceScore: number;
    /** Uncertainty score from UncertaintyAggregator (0-1) */
    uncertaintyScore: number;
    /** Elapsed time in milliseconds since run start */
    elapsedMs: number;
    /** Step number of the last checkpoint */
    lastCheckpointStep: number;
    /** Remaining budget across all dimensions */
    budgetRemaining: {
        tokens: number;
        toolCalls: number;
        timeMs: number;
    };
    /** Recent evaluation decisions (last 10) */
    recentDecisions: Array<{
        step: number;
        decision: 'allow' | 'deny' | 'warn';
    }>;
}
/**
 * Decision outcome from the continue gate
 */
export interface ContinueDecision {
    /** The decision type */
    decision: 'continue' | 'checkpoint' | 'throttle' | 'pause' | 'stop';
    /** Human-readable reasons for the decision */
    reasons: string[];
    /** Computed metrics for this evaluation */
    metrics: {
        /** Budget acceleration rate (tokens per step slope) */
        budgetSlope: number;
        /** Ratio of rework steps to total steps */
        reworkRatio: number;
        /** Steps until next required checkpoint */
        stepsUntilCheckpoint: number;
        /** Coherence health level */
        coherenceLevel: 'healthy' | 'degraded' | 'critical';
        /** Uncertainty level */
        uncertaintyLevel: 'low' | 'moderate' | 'high' | 'extreme';
    };
    /** Recommended action for the agent */
    recommendedAction?: string;
}
/**
 * Gate that evaluates whether a long-running agent should continue.
 *
 * Prevents runaway execution by checking:
 * - Step limits
 * - Budget exhaustion and acceleration
 * - Coherence degradation
 * - Uncertainty thresholds
 * - Rework ratios
 * - Checkpoint intervals
 *
 * Maintains history of evaluations and provides aggregate statistics.
 */
export declare class ContinueGate {
    private readonly config;
    private readonly history;
    private lastEvaluationTime;
    private readonly tokenHistory;
    constructor(config?: Partial<ContinueGateConfig>);
    /**
     * Evaluate whether the agent should continue.
     *
     * Applies decision logic in priority order:
     * 1. Coherence below threshold → stop
     * 2. Step limit exceeded → stop
     * 3. Budget exhausted → stop
     * 4. High rework ratio → pause
     * 5. High uncertainty → pause
     * 6. Budget acceleration → throttle
     * 7. Checkpoint interval reached → checkpoint
     * 8. Otherwise → continue
     *
     * @param context - Current step context
     * @returns Decision with reasons and metrics
     */
    evaluate(context: StepContext): ContinueDecision;
    /**
     * Evaluate and record the decision in history.
     *
     * This method also checks the cooldown period — if called too soon
     * after the last evaluation, it returns a 'continue' decision without
     * full evaluation to prevent excessive overhead.
     *
     * @param context - Current step context
     * @returns Decision with reasons and metrics
     */
    evaluateWithHistory(context: StepContext): ContinueDecision;
    /**
     * Get the full evaluation history.
     *
     * Returns up to MAX_HISTORY_SIZE most recent evaluations.
     *
     * @returns Array of evaluation records ordered oldest to newest
     */
    getHistory(): Array<{
        step: number;
        decision: ContinueDecision;
        timestamp: number;
    }>;
    /**
     * Get aggregate statistics across all evaluations.
     *
     * @returns Statistics including total evaluations, decision counts, and average budget slope
     */
    getStats(): {
        totalEvaluations: number;
        decisions: Record<string, number>;
        averageBudgetSlope: number;
    };
    /**
     * Reset all internal state.
     *
     * Clears history, token tracking, and last evaluation time.
     */
    reset(): void;
    /**
     * Get the current configuration.
     */
    getConfig(): ContinueGateConfig;
    /**
     * Compute the budget slope (rate of token consumption per step)
     * using linear regression on the last N steps.
     *
     * Returns the slope coefficient (tokens per step). A positive slope
     * indicates increasing token usage. A slope above the configured
     * threshold indicates budget acceleration.
     */
    private computeBudgetSlope;
    /**
     * Map coherence score to a health level.
     */
    private getCoherenceLevel;
    /**
     * Map uncertainty score to a level.
     */
    private getUncertaintyLevel;
    /**
     * Create a standardized decision object.
     */
    private createDecision;
}
/**
 * Create a ContinueGate instance with optional configuration.
 *
 * @param config - Partial configuration; unspecified values use defaults
 * @returns A fresh ContinueGate instance
 */
export declare function createContinueGate(config?: Partial<ContinueGateConfig>): ContinueGate;
//# sourceMappingURL=continue-gate.d.ts.map