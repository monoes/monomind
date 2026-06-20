import type { MonographDb } from '../storage/db.js';
export interface PruneResult {
    danglingEdgesRemoved: number;
    orphanNodesRemoved: number;
    staleFileNodesRemoved: number;
}
/**
 * Remove edges whose source or target node does not exist in the nodes table.
 *
 * @param db - The MonographDb instance (better-sqlite3 Database)
 * @returns The number of dangling edges pruned
 */
export declare function pruneDanglingEdges(db: MonographDb): number;
/**
 * Remove non-File nodes that have no incoming or outgoing edges.
 * Leaves File nodes in place so they can still be queried even if isolated.
 *
 * @param db - The MonographDb instance
 * @returns Number of orphan nodes removed
 */
export declare function pruneOrphanNodes(db: MonographDb): number;
/**
 * Remove File nodes whose file_path no longer exists on disk.
 * Also cascades to remove any edges connected to those nodes (via pruneDanglingEdges).
 *
 * @param db - The MonographDb instance
 * @param existingPaths - Set of file paths that currently exist on disk
 * @returns Number of stale File nodes removed (call pruneDanglingEdges after to clean edges)
 */
export declare function pruneStaleFileNodes(db: MonographDb, existingPaths: Set<string>): number;
/**
 * Run a full prune pass: dangling edges → orphan nodes → stale file nodes.
 * Optionally pass existingPaths to also remove deleted-file nodes.
 */
export declare function pruneAll(db: MonographDb, existingPaths?: Set<string>): PruneResult;
/**
 * Format a PruneResult as structured text for LLM consumption.
 */
export declare function formatPruneResult(result: PruneResult): string;
//# sourceMappingURL=prune.d.ts.map