import type { MonographDb } from '../storage/db.js';
/**
 * Detect dead code: nodes that have in-degree 0 AND are not marked as exported.
 *
 * In a module dependency graph, a node with in-degree 0 is never imported by
 * any other module. If it is also not explicitly exported (i.e., not an entry-point),
 * it is considered dead code — unreachable and unused.
 *
 * @param db - The MonographDb instance
 * @returns Array of node ids that are considered dead code.
 */
export declare function detectDeadCode(db: MonographDb): string[];
//# sourceMappingURL=dead-code.d.ts.map