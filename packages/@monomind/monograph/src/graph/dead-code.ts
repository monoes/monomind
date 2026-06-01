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
export function detectDeadCode(db: MonographDb): string[] {
  const nodeRows = db.prepare('SELECT id, is_exported FROM nodes').all() as {
    id: string;
    is_exported: number;
  }[];

  if (nodeRows.length === 0) return [];

  // Count in-degrees
  const inDegree = new Map<string, number>();
  for (const { id } of nodeRows) {
    inDegree.set(id, 0);
  }

  const edgeRows = db.prepare('SELECT target_id FROM edges WHERE source_id != target_id').all() as {
    target_id: string;
  }[];

  for (const { target_id } of edgeRows) {
    if (inDegree.has(target_id)) {
      inDegree.set(target_id, (inDegree.get(target_id) ?? 0) + 1);
    }
  }

  const dead: string[] = [];
  for (const { id, is_exported } of nodeRows) {
    if ((inDegree.get(id) ?? 0) === 0 && is_exported !== 1) {
      dead.push(id);
    }
  }

  return dead;
}
