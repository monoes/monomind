/**
 * Intelligent Model Router using Tiny Dancer
 *
 * Dynamically routes requests to optimal Claude model (haiku/sonnet/opus)
 * based on task complexity, confidence scores, and historical performance.
 *
 * Features:
 * - FastGRNN-based routing decisions (<100μs)
 * - Uncertainty quantification for model escalation
 * - Circuit breaker for failover
 * - Online learning from routing outcomes
 * - Complexity scoring via embeddings
 *
 * Routing Strategy:
 * - Haiku: High confidence, low complexity (fast, cheap)
 * - Sonnet: Medium confidence, moderate complexity (balanced)
 * - Opus: Low confidence, high complexity (most capable)
 *
 * @module model-router
 */
/**
 * Available Claude models for routing
 */
export type ClaudeModel = 'haiku' | 'sonnet' | 'opus' | 'inherit';
/**
 * Model capabilities and characteristics
 */
export declare const MODEL_CAPABILITIES: Record<ClaudeModel, {
    maxComplexity: number;
    costMultiplier: number;
    speedMultiplier: number;
    description: string;
}>;
/**
 * Complexity indicators for task classification
 */
export declare const COMPLEXITY_INDICATORS: {
    high: string[];
    medium: string[];
    low: string[];
};
/**
 * Model router configuration
 */
export interface ModelRouterConfig {
    /** Confidence threshold for model selection (default: 0.85) */
    confidenceThreshold: number;
    /** Maximum uncertainty before escalating (default: 0.15) */
    maxUncertainty: number;
    /** Enable circuit breaker (default: true) */
    enableCircuitBreaker: boolean;
    /** Failures before circuit opens (default: 5) */
    circuitBreakerThreshold: number;
    /** Path for router state persistence */
    statePath: string;
    /** Auto-save interval in decisions (default: 20) */
    autoSaveInterval: number;
    /** Enable cost optimization (default: true) */
    enableCostOptimization: boolean;
    /** Prefer faster models when confidence is high (default: true) */
    preferSpeed: boolean;
}
/**
 * Routing decision result
 */
export interface ModelRoutingResult {
    /** Selected model */
    model: ClaudeModel;
    /** Confidence in the decision (0-1) */
    confidence: number;
    /** Uncertainty estimate (0-1) */
    uncertainty: number;
    /** Computed complexity score (0-1) */
    complexity: number;
    /** Reasoning for the selection */
    reasoning: string;
    /** Alternative models considered */
    alternatives: Array<{
        model: ClaudeModel;
        score: number;
    }>;
    /** Inference time in microseconds */
    inferenceTimeUs: number;
    /** Estimated cost multiplier */
    costMultiplier: number;
}
/**
 * Complexity analysis result
 */
export interface ComplexityAnalysis {
    /** Overall complexity score (0-1) */
    score: number;
    /** Indicators found */
    indicators: {
        high: string[];
        medium: string[];
        low: string[];
    };
    /** Feature breakdown */
    features: {
        lexicalComplexity: number;
        semanticDepth: number;
        taskScope: number;
        uncertaintyLevel: number;
    };
}
/**
 * Intelligent Model Router using complexity-based routing
 */
export declare class ModelRouter {
    private config;
    private state;
    private decisionCount;
    private consecutiveFailures;
    constructor(config?: Partial<ModelRouterConfig>);
    /**
     * Route a task to the optimal model
     */
    route(task: string, embedding?: number[]): Promise<ModelRoutingResult>;
    /**
     * Analyze task complexity
     */
    analyzeComplexity(task: string, embedding?: number[]): ComplexityAnalysis;
    /**
     * Compute lexical complexity from text features
     */
    private computeLexicalComplexity;
    /**
     * Compute semantic depth from indicators and embedding
     */
    private computeSemanticDepth;
    /**
     * Compute task scope from content analysis
     */
    private computeTaskScope;
    /**
     * Compute uncertainty level from task phrasing
     */
    private computeUncertaintyLevel;
    /**
     * Compute scores for each model
     */
    private computeModelScores;
    /**
     * Apply circuit breaker adjustments
     */
    private applyCircuitBreaker;
    /**
     * Select the best model from scores
     */
    private selectModel;
    /**
     * Build human-readable reasoning
     */
    private buildReasoning;
    /**
     * Track routing decision for learning
     */
    private trackDecision;
    /**
     * Record outcome for learning
     */
    recordOutcome(task: string, model: ClaudeModel, outcome: 'success' | 'failure' | 'escalated', complexity?: number): void;
    /**
     * Get router statistics
     */
    getStats(): {
        totalDecisions: number;
        modelDistribution: Record<ClaudeModel, number>;
        avgComplexity: number;
        avgConfidence: number;
        circuitBreakerTrips: number;
        consecutiveFailures: Record<ClaudeModel, number>;
    };
    /**
     * Load state from disk
     */
    private loadState;
    /**
     * Save state to disk
     */
    private saveState;
    /**
     * Reset router state
     */
    reset(): void;
}
/**
 * Get or create the singleton ModelRouter instance.
 * Throws if called with a config that differs from the one used to create
 * the existing instance — silent config mismatch causes hard-to-debug routing bugs.
 */
export declare function getModelRouter(config?: Partial<ModelRouterConfig>): ModelRouter;
/**
 * Reset the singleton instance
 */
export declare function resetModelRouter(): void;
/**
 * Create a new ModelRouter instance (non-singleton)
 */
export declare function createModelRouter(config?: Partial<ModelRouterConfig>): ModelRouter;
/**
 * Quick route function for common use case
 */
export declare function routeToModel(task: string): Promise<ClaudeModel>;
/**
 * Route with full result
 */
export declare function routeToModelFull(task: string, embedding?: number[]): Promise<ModelRoutingResult>;
/**
 * Analyze task complexity without routing
 */
export declare function analyzeTaskComplexity(task: string): ComplexityAnalysis;
/**
 * Get model router statistics
 */
export declare function getModelRouterStats(): ReturnType<ModelRouter['getStats']>;
/**
 * Record routing outcome for learning
 */
export declare function recordModelOutcome(task: string, model: ClaudeModel, outcome: 'success' | 'failure' | 'escalated'): void;
//# sourceMappingURL=model-router.d.ts.map