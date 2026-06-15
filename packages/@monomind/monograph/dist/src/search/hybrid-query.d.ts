/**
 * Hybrid BM25 + vector search with Reciprocal Rank Fusion.
 *
 * When MONOGRAPH_EMBEDDINGS=true (or an embedder is provided), the query is
 * embedded and cosine similarity is computed in JavaScript against all stored
 * vectors.  Both result lists are merged via RRF(K=60).
 *
 * If embeddings are unavailable (table empty, env not set, no embedder),
 * the function falls back to BM25 only — same behaviour as before.
 */
import type Database from 'better-sqlite3';
import type { EmbedderFn } from './embedder.js';
import { type RankedResult } from './rrf.js';
export interface HybridQueryOptions {
    limit?: number;
    label?: string;
    /** Explicit embedder — overrides MONOGRAPH_EMBEDDINGS env check */
    embedder?: EmbedderFn;
}
export interface HybridResult extends RankedResult {
    id: string;
    name: string;
    normLabel: string;
    filePath: string | null;
    label: string;
    score: number;
    /** First line of the symbol in its source file (1-based, null if unknown). */
    startLine?: number | null;
    /** Last line of the symbol in its source file (1-based, null if unknown). */
    endLine?: number | null;
}
/**
 * Run a hybrid BM25 + cosine search.
 *
 * Falls back to BM25-only when:
 *  - MONOGRAPH_EMBEDDINGS env var is not 'true' AND no explicit embedder is given
 *  - The embeddings table is empty
 *  - Embedding the query string fails
 */
export declare function hybridQuery(db: Database.Database, query: string, options?: HybridQueryOptions): Promise<HybridResult[]>;
//# sourceMappingURL=hybrid-query.d.ts.map