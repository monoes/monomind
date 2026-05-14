/**
 * Enhanced Model Router with Agent Booster AST Integration
 *
 * Implements ADR-026: 3-tier intelligent model routing:
 * - Tier 1: Agent Booster (WASM) - <1ms, $0 for simple transforms
 * - Tier 2: Haiku - ~500ms for low complexity
 * - Tier 3: Sonnet/Opus - 2-5s for high complexity
 *
 * @module enhanced-model-router
 */
import { ClaudeModel, ModelRouter } from './model-router.js';
/**
 * Code editing intent types that Agent Booster can handle
 */
export type EditIntentType = 'var-to-const' | 'add-types' | 'add-error-handling' | 'async-await' | 'add-logging' | 'remove-console';
/**
 * Detected edit intent from task analysis
 */
export interface EditIntent {
    type: EditIntentType;
    confidence: number;
    filePath?: string;
    language?: string;
    description: string;
}
/**
 * Enhanced routing result with Agent Booster support
 */
export interface EnhancedRouteResult {
    tier: 1 | 2 | 3;
    handler: 'agent-booster' | 'haiku' | 'sonnet' | 'opus';
    model?: ClaudeModel;
    confidence: number;
    complexity?: number;
    reasoning: string;
    agentBoosterIntent?: EditIntent;
    canSkipLLM?: boolean;
    estimatedLatencyMs: number;
    estimatedCost: number;
}
/**
 * Enhanced model router configuration
 */
export interface EnhancedModelRouterConfig {
    agentBoosterEnabled: boolean;
    agentBoosterConfidenceThreshold: number;
    enabledIntents: EditIntentType[];
    complexityThresholds: {
        haiku: number;
        sonnet: number;
        opus: number;
    };
    preferCost: boolean;
    preferQuality: boolean;
}
/**
 * Enhanced Model Router with Agent Booster AST integration
 *
 * Provides intelligent 3-tier routing:
 * - Tier 1: Agent Booster for simple code transforms (352x faster, $0)
 * - Tier 2: Haiku for low complexity tasks
 * - Tier 3: Sonnet/Opus for complex reasoning tasks
 */
export declare class EnhancedModelRouter {
    private config;
    private tinyDancerRouter;
    constructor(config?: Partial<EnhancedModelRouterConfig>);
    /**
     * Detect code editing intent from task description
     */
    detectIntent(task: string): EditIntent | null;
    /**
     * Extract file path from task description
     */
    private extractFilePath;
    /**
     * Detect language from file extension
     */
    private detectLanguage;
    /**
     * Check if task contains Tier 3 (Opus) keywords
     */
    private containsTier3Keywords;
    /**
     * Route a task to the optimal tier and handler
     */
    route(task: string, context?: {
        filePath?: string;
    }): Promise<EnhancedRouteResult>;
    /**
     * Analyze AST complexity of a file
     * Returns normalized complexity score (0-1)
     */
    private analyzeASTComplexity;
    /**
     * Execute task using the appropriate tier
     * Returns the result and routing information
     */
    execute(task: string, context?: {
        filePath?: string;
        originalCode?: string;
    }): Promise<{
        result: string | {
            applied: boolean;
            confidence: number;
        };
        routeResult: EnhancedRouteResult;
    }>;
    /**
     * Try to apply edit using Agent Booster
     */
    private tryAgentBooster;
    /**
     * Get router statistics
     */
    getStats(): {
        config: EnhancedModelRouterConfig;
        tinyDancerStats: ReturnType<ModelRouter['getStats']>;
    };
}
/**
 * Get or create the singleton EnhancedModelRouter instance
 */
export declare function getEnhancedModelRouter(config?: Partial<EnhancedModelRouterConfig>): EnhancedModelRouter;
/**
 * Reset the singleton instance
 */
export declare function resetEnhancedModelRouter(): void;
/**
 * Create a new EnhancedModelRouter instance (non-singleton)
 */
export declare function createEnhancedModelRouter(config?: Partial<EnhancedModelRouterConfig>): EnhancedModelRouter;
/**
 * Quick route function with enhanced routing
 */
export declare function enhancedRouteToModel(task: string, context?: {
    filePath?: string;
}): Promise<EnhancedRouteResult>;
/**
 * Detect if a task can be handled by Agent Booster
 */
export declare function canUseAgentBooster(task: string): {
    canUse: boolean;
    intent?: EditIntent;
};
//# sourceMappingURL=enhanced-model-router.d.ts.map