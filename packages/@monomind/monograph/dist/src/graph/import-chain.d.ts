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
 * Uses BFS/DFS with cycle detection. Returns all simple paths up to `maxDepth`.
 *
 * @param db - The MonographDb instance
 * @param sourceId - Starting node id
 * @param targetId - Destination node id
 * @param options - Optional tuning parameters
 * @returns Array of paths; each path is an ordered array of node ids from source to target.
 */
export declare function traceImportChain(db: MonographDb, sourceId: string, targetId: string, options?: ImportChainOptions): string[][];
//# sourceMappingURL=import-chain.d.ts.map