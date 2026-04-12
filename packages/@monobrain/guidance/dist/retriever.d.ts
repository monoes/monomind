/**
 * Task Intent Classifier + Shard Retriever
 *
 * Stores rule shards in vector storage with embeddings and metadata.
 * At task start, retrieves the top N shards by semantic similarity
 * with hard filters by risk class and repo scope.
 *
 * Retrieval contract:
 * 1. Always include the constitution
 * 2. Retrieve up to 5 shards by semantic similarity
 * 3. Add hard filters by risk class and repo scope
 * 4. Contradiction check: prefer higher-priority rule ID
 *
 * @module @monobrain/guidance/retriever
 */
import type { PolicyBundle, Constitution, TaskIntent, RetrievalRequest, RetrievalResult } from './types.js';
export interface IEmbeddingProvider {
    embed(text: string): Promise<Float32Array>;
    batchEmbed(texts: string[]): Promise<Float32Array[]>;
}
/**
 * Deterministic hash-based embedding provider — **test-only**.
 *
 * Produces fixed-dimension vectors from a simple character-hash → sin()
 * transform.  The resulting embeddings have no real semantic meaning;
 * they are stable and fast, which makes them useful for unit/integration
 * tests that need a concrete {@link IEmbeddingProvider} without loading
 * an ONNX model.
 *
 * **Do NOT use in production** — replace with a real model-backed
 * provider (e.g. the agentic-flow ONNX integration).
 */
export declare class HashEmbeddingProvider implements IEmbeddingProvider {
    private dimensions;
    private cache;
    constructor(dimensions?: number);
    embed(text: string): Promise<Float32Array>;
    batchEmbed(texts: string[]): Promise<Float32Array[]>;
    private hashEmbed;
}
export declare class ShardRetriever {
    private shards;
    private constitution;
    private embeddingProvider;
    private indexed;
    private globCache;
    constructor(embeddingProvider?: IEmbeddingProvider);
    /**
     * Load a compiled policy bundle
     */
    loadBundle(bundle: PolicyBundle): Promise<void>;
    /**
     * Index all shards by generating embeddings
     */
    indexShards(): Promise<void>;
    /**
     * Classify task intent
     */
    classifyIntent(taskDescription: string): {
        intent: TaskIntent;
        confidence: number;
    };
    /**
     * Retrieve relevant shards for a task
     *
     * Contract:
     * 1. Always include the constitution
     * 2. Up to maxShards by semantic similarity
     * 3. Hard filters by risk class and repo scope
     * 4. Contradiction check: prefer higher priority
     */
    retrieve(request: RetrievalRequest): Promise<RetrievalResult>;
    /**
     * Score all shards against the query
     */
    private scoreShards;
    /**
     * Select top N shards with contradiction checking
     * When two rules contradict, keep the one with higher priority
     */
    private selectWithContradictionCheck;
    /**
     * Check if two rules are contradictory
     */
    private areContradictory;
    /**
     * Count contradictions in selected set
     */
    private countContradictions;
    /**
     * Build combined policy text for injection
     */
    private buildPolicyText;
    /**
     * Simple glob matching (supports * and **).
     * Compiled regexes are cached per glob to avoid re-compiling on every call.
     */
    private matchGlob;
    /**
     * Cosine similarity between two vectors
     */
    private cosineSimilarity;
    /**
     * Get current shard count
     */
    get shardCount(): number;
    /**
     * Get constitution
     */
    getConstitution(): Constitution | null;
}
/**
 * Create a retriever instance
 */
export declare function createRetriever(embeddingProvider?: IEmbeddingProvider): ShardRetriever;
//# sourceMappingURL=retriever.d.ts.map