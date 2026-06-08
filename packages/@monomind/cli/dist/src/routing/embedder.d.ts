/**
 * Calibrated similarity threshold for the arctic-embed space.
 *
 * Empirically (leave-one-out over the route utterances): genuine task matches
 * score ~0.85–0.91 against the correct route centroid, while off-topic / nonsense
 * input tops out around ~0.74. 0.80 sits in that gap — real tasks route
 * `semantic`, junk falls through to the LLM fallback.
 */
export declare const SEMANTIC_EMBEDDING_THRESHOLD = 0.8;
export interface SemanticRouting {
    /** Embeds one text → 384-dim L2-normalized vector. */
    embeddingGenerator: (text: string) => Promise<number[]>;
    /** Route centroids aligned 1:1 with the input routes (cached on disk). */
    centroids: number[][];
    /** Calibrated `globalThreshold` for this embedder. */
    globalThreshold: number;
}
interface RouteLike {
    name: string;
    utterances: string[];
}
/**
 * Build the real-embedding routing config for a route set, or null when the
 * embedding model can't be loaded (caller then routes keyword + LocalEncoder).
 *
 * Route centroids are computed once (~6s for ~500 utterances) and cached to
 * `~/.monomind/cache`; subsequent calls load them in milliseconds.
 */
export declare function createSemanticRouting(routes: RouteLike[]): Promise<SemanticRouting | null>;
export {};
//# sourceMappingURL=embedder.d.ts.map