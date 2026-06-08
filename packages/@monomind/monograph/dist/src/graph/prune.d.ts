import type { MonographDb } from '../storage/db.js';
/**
 * Remove edges whose source or target node does not exist in the nodes table.
 *
 * @param db - The MonographDb instance (better-sqlite3 Database)
 * @returns The number of dangling edges pruned
 */
export declare function pruneDanglingEdges(db: MonographDb): number;
//# sourceMappingURL=prune.d.ts.map