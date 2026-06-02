import type { MonographDb } from '../storage/db.js';

/**
 * Remove edges whose source or target node does not exist in the nodes table.
 *
 * @param db - The MonographDb instance (better-sqlite3 Database)
 * @returns The number of dangling edges pruned
 */
export function pruneDanglingEdges(db: MonographDb): number {
  // Single-statement DELETE avoids fetching all dangling IDs then re-binding them
  // as SQL variables (which would fail when edge count exceeds SQLITE_MAX_VARIABLE_NUMBER).
  const result = db.prepare(`
    DELETE FROM edges
    WHERE NOT EXISTS (SELECT 1 FROM nodes n WHERE n.id = source_id)
       OR NOT EXISTS (SELECT 1 FROM nodes n WHERE n.id = target_id)
  `).run();

  return result.changes;
}
