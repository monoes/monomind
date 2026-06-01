import type { MonographDb } from '../storage/db.js';

/**
 * Remove edges whose source or target node does not exist in the nodes table.
 *
 * @param db - The MonographDb instance (better-sqlite3 Database)
 * @returns The number of dangling edges pruned
 */
export function pruneDanglingEdges(db: MonographDb): number {
  // Find all edge ids where source or target is missing from nodes
  const danglingIds = db.prepare(`
    SELECT e.id
    FROM edges e
    WHERE NOT EXISTS (SELECT 1 FROM nodes n WHERE n.id = e.source_id)
       OR NOT EXISTS (SELECT 1 FROM nodes n WHERE n.id = e.target_id)
  `).all() as { id: string }[];

  if (danglingIds.length === 0) return 0;

  const placeholders = danglingIds.map(() => '?').join(',');
  const ids = danglingIds.map(r => r.id);
  db.prepare(`DELETE FROM edges WHERE id IN (${placeholders})`).run(...ids);

  return danglingIds.length;
}
