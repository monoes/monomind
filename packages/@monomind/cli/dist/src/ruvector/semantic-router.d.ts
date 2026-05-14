/**
 * Pure JavaScript SemanticRouter implementation
 *
 * Provides intent routing using cosine similarity.
 * This is a fallback implementation since @ruvector/router's native VectorDb has bugs.
 *
 * Performance: ~50,000 routes/sec with 100 intents (sufficient for agent routing)
 */
export interface Intent {
    name: string;
    utterances: string[];
    metadata?: Record<string, unknown>;
}
export interface RouteResult {
    intent: string;
    score: number;
    metadata: Record<string, unknown>;
}
export interface RouterConfig {
    dimension: number;
    metric?: 'cosine' | 'euclidean' | 'dotProduct';
}
export declare class SemanticRouter {
    private dimension;
    private metric;
    private intents;
    private totalVectors;
    constructor(config: RouterConfig);
    /**
     * Add an intent with pre-computed embeddings
     */
    addIntentWithEmbeddings(name: string, embeddings: Float32Array[], metadata?: Record<string, unknown>): void;
    /**
     * Route a query using a pre-computed embedding
     */
    routeWithEmbedding(embedding: Float32Array, k?: number): RouteResult[];
    /**
     * Remove an intent
     */
    removeIntent(name: string): boolean;
    /**
     * Get all intent names
     */
    getIntents(): string[];
    /**
     * Get intent details
     */
    getIntent(name: string): Intent | null;
    /**
     * Clear all intents
     */
    clear(): void;
    /**
     * Get total vector count
     */
    count(): number;
    /**
     * Get number of intents
     */
    intentCount(): number;
    /**
     * Normalize a vector for cosine similarity
     */
    private normalize;
    /**
     * Calculate similarity between two normalized vectors
     */
    private similarity;
    private dotProduct;
    private euclideanDistance;
}
/**
 * Create a SemanticRouter with the given configuration
 */
export declare function createSemanticRouter(config: RouterConfig): SemanticRouter;
export default SemanticRouter;
//# sourceMappingURL=semantic-router.d.ts.map