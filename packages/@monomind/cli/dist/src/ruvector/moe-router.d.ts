/**
 * Mixture of Experts (MoE) Router for Dynamic Agent Routing
 *
 * Features:
 * - 8 expert slots for specialized agent types
 * - Gating network for soft expert selection (top-k)
 * - Online weight updates via reward signals
 * - Load balancing with auxiliary loss
 * - Weight persistence to .swarm/moe-weights.json
 *
 * Architecture:
 * - Input: 384-dim task embedding (from ONNX)
 * - Hidden: 128-dim layer with ReLU
 * - Output: 8-dim softmax weights
 *
 * @module moe-router
 */
/**
 * Expert type definitions (8 experts)
 */
export type ExpertType = 'coder' | 'tester' | 'reviewer' | 'architect' | 'security' | 'performance' | 'researcher' | 'coordinator';
/**
 * Expert names in order (index corresponds to expert slot)
 */
export declare const EXPERT_NAMES: ExpertType[];
/**
 * Number of experts (fixed at 8)
 */
export declare const NUM_EXPERTS = 8;
/**
 * Input dimension (384 from ONNX MiniLM-L6-v2)
 */
export declare const INPUT_DIM = 384;
/**
 * Hidden layer dimension
 */
export declare const HIDDEN_DIM = 128;
/**
 * MoE Router configuration
 */
export interface MoERouterConfig {
    /** Top-k experts to route to (default: 2) */
    topK: number;
    /** Learning rate for online updates (default: 0.01) */
    learningRate: number;
    /** Temperature for softmax (default: 1.0) */
    temperature: number;
    /** Load balancing coefficient (default: 0.01) */
    loadBalanceCoef: number;
    /** Path for weight persistence (default: '.swarm/moe-weights.json') */
    weightsPath: string;
    /** Auto-save interval in updates (default: 50) */
    autoSaveInterval: number;
    /** Enable noise for exploration (default: true) */
    enableNoise: boolean;
    /** Noise standard deviation (default: 0.1) */
    noiseStd: number;
}
/**
 * Expert routing result
 */
export interface RoutingResult {
    /** Selected experts with weights */
    experts: Array<{
        name: ExpertType;
        index: number;
        weight: number;
        score: number;
    }>;
    /** Raw gating scores (all experts) */
    allScores: number[];
    /** Load balance loss */
    loadBalanceLoss: number;
    /** Entropy of routing distribution */
    entropy: number;
}
/**
 * Expert utilization statistics
 */
export interface LoadBalanceStats {
    /** Per-expert utilization (0-1) */
    utilization: Record<ExpertType, number>;
    /** Total routing count */
    totalRoutings: number;
    /** Per-expert routing count */
    routingCounts: Record<ExpertType, number>;
    /** Gini coefficient of load (0 = perfect balance, 1 = all to one) */
    giniCoefficient: number;
    /** Coefficient of variation */
    coefficientOfVariation: number;
}
/**
 * Mixture of Experts Router
 *
 * Implements a two-layer gating network:
 * - Layer 1: Linear(384, 128) + ReLU
 * - Layer 2: Linear(128, 8) + Softmax
 *
 * Uses top-k expert selection with load balancing.
 */
export declare class MoERouter {
    private config;
    private W1;
    private b1;
    private W2;
    private b2;
    private hidden;
    private hiddenWithBias;
    private hiddenActivated;
    private logits;
    private logitsWithBias;
    private noisyLogits;
    private probs;
    private gradW2;
    private gradb2;
    private gradW1;
    private gradb1;
    private gradHidden;
    private routingCounts;
    private totalRoutings;
    private updateCount;
    private avgReward;
    private lastInput;
    private lastHiddenActivated;
    private lastProbs;
    private lastSelectedExperts;
    constructor(config?: Partial<MoERouterConfig>);
    /**
     * Initialize router, loading persisted weights if available
     */
    initialize(): Promise<void>;
    /**
     * Route task to top-k experts based on embedding
     *
     * @param taskEmbedding - 384-dim task embedding from ONNX
     * @returns Routing result with selected experts and weights
     */
    route(taskEmbedding: Float32Array | number[]): RoutingResult;
    /**
     * Update expert weights based on reward signal
     *
     * Uses REINFORCE-style gradient update:
     * gradient = reward * d_log_prob / d_weights
     *
     * @param expert - Expert that received the reward
     * @param reward - Reward signal (-1 to 1, positive = good)
     */
    updateExpertWeights(expert: ExpertType | number, reward: number): void;
    /**
     * Get load balance statistics across all experts
     */
    getLoadBalance(): LoadBalanceStats;
    /**
     * Get router statistics
     */
    getStats(): Record<string, number | string>;
    /**
     * Reset all statistics and routing counts
     */
    resetStats(): void;
    /**
     * Load weights from persistence file
     */
    loadWeights(path?: string): Promise<boolean>;
    /**
     * Save weights to persistence file
     */
    saveWeights(path?: string): Promise<boolean>;
    /**
     * Reset weights to random initialization
     */
    resetWeights(): void;
    /**
     * Select top-k indices from probabilities
     */
    private selectTopK;
    /**
     * Compute load balance loss for regularization
     *
     * Uses auxiliary loss from Switch Transformer:
     * L_balance = N * sum(f_i * P_i)
     * where f_i = fraction of tokens routed to expert i
     *       P_i = average routing probability to expert i
     */
    private computeLoadBalanceLoss;
    /**
     * Compute Gini coefficient for load distribution
     */
    private computeGiniCoefficient;
}
/**
 * Get singleton MoE router instance
 *
 * @param config - Optional configuration (only used on first call)
 * @returns MoE router instance
 */
export declare function getMoERouter(config?: Partial<MoERouterConfig>): MoERouter;
/**
 * Get singleton MoE router instance, waiting for initialization to complete
 *
 * @param config - Optional configuration (only used on first call)
 * @returns Promise resolving to fully initialized MoE router instance
 */
export declare function getMoERouterReady(config?: Partial<MoERouterConfig>): Promise<MoERouter>;
/**
 * Reset singleton instance (for testing)
 */
export declare function resetMoERouter(): void;
/**
 * Factory function to create new router
 */
export declare function createMoERouter(config?: Partial<MoERouterConfig>): MoERouter;
//# sourceMappingURL=moe-router.d.ts.map