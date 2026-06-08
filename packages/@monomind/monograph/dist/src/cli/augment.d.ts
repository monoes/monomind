/**
 * augmentContext — Graph-RAG context augmentation
 *
 * Given a query string, retrieves the top-K relevant nodes from the
 * monograph knowledge graph using hybrid BM25+vector search (falls back
 * to BM25 when embeddings are unavailable) and returns a formatted
 * context block suitable for injection into an AI prompt.
 *
 * Usable from both CLI entry points and the monograph_augment MCP tool.
 */
import { type HybridResult } from '../search/hybrid-query.js';
export interface AugmentContextOptions {
    /** The search query or task description */
    query: string;
    /** Absolute path to the repository root */
    repoPath: string;
    /** Number of results to retrieve (default: 10) */
    topK?: number;
    /** Output format (default: 'markdown') */
    format?: 'markdown' | 'json';
}
export interface AugmentContextResult {
    query: string;
    topK: number;
    format: 'markdown' | 'json';
    results: HybridResult[];
    context: string;
}
/**
 * Retrieve the top-K relevant code nodes for a query and return a
 * formatted context string.
 */
export declare function augmentContext(options: AugmentContextOptions): Promise<string>;
//# sourceMappingURL=augment.d.ts.map