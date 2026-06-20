import type { MonographDb } from '../storage/db.js';
export interface ImportChainOptions {
    /** Maximum path depth. Default: 10 */
    maxDepth?: number;
    /** Maximum number of paths to return (prevents explosion). Default: 100 */
    maxPaths?: number;
}
/**
 * Trace all import chains (paths) from `sourceId` to `targetId`.
 *
 * Uses frontier-based BFS with lazy edge loading: only fetches outgoing edges
 * for nodes as they are visited, avoiding loading the full edge table when
 * the graph is large.  Returns all simple paths up to `maxDepth`.
 *
 * @param db - The MonographDb instance
 * @param sourceId - Starting node id
 * @param targetId - Destination node id
 * @param options - Optional tuning parameters
 * @returns Array of paths; each path is an ordered array of node ids from source to target.
 */
export declare function traceImportChain(db: MonographDb, sourceId: string, targetId: string, options?: ImportChainOptions): string[][];
/**
 * Format import-chain paths as structured text.
 *
 * Resolves node IDs to human-readable names (name + file_path) for LLM
 * context injection.  Each path is printed as an arrow chain with file:line
 * hints where available.
 *
 * @param db - The MonographDb instance (used for name resolution)
 * @param paths - Result of traceImportChain()
 * @param sourceId - Source node id (for summary line)
 * @param targetId - Target node id (for summary line)
 * @returns Structured text string
 */
export declare function formatImportChain(db: MonographDb, paths: string[][], sourceId: string, targetId: string): string;
//# sourceMappingURL=import-chain.d.ts.map