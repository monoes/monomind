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

/**
 * Remove non-File nodes that have no incoming or outgoing edges.
 * Leaves File nodes in place so they can still be queried even if isolated.
 *
 * @param db - The MonographDb instance
 * @returns Number of orphan nodes removed
 */
export function pruneOrphanNodes(db: MonographDb): number {
  const result = db.prepare(`
    DELETE FROM nodes
    WHERE label != 'File'
      AND NOT EXISTS (SELECT 1 FROM edges WHERE source_id = nodes.id OR target_id = nodes.id)
  `).run();
  return result.changes;
}

/**
 * Remove File nodes whose file_path no longer exists on disk.
 * Also cascades to remove any edges connected to those nodes (via pruneDanglingEdges).
 *
 * @param db - The MonographDb instance
 * @param existingPaths - Set of file paths that currently exist on disk
 * @returns Number of stale File nodes removed (call pruneDanglingEdges after to clean edges)
 */
export function pruneStaleFileNodes(db: MonographDb, existingPaths: Set<string>): number {
  const staleRows = db.prepare(
    `SELECT id, file_path FROM nodes WHERE label = 'File' AND file_path IS NOT NULL`,
  ).all() as { id: string; file_path: string }[];

  let removed = 0;
  const deleteStmt = db.prepare(`DELETE FROM nodes WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const row of staleRows) {
      if (!existingPaths.has(row.file_path)) {
        deleteStmt.run(row.id);
        removed++;
      }
    }
  });
  tx();
  return removed;
}

/**
 * Run a full prune pass: dangling edges → orphan nodes → stale file nodes.
 * Optionally pass existingPaths to also remove deleted-file nodes.
 */
export function pruneAll(db: MonographDb, existingPaths?: Set<string>): PruneResult {
  const danglingEdgesRemoved = pruneDanglingEdges(db);
  const orphanNodesRemoved = pruneOrphanNodes(db);
  const staleFileNodesRemoved = existingPaths ? pruneStaleFileNodes(db, existingPaths) : 0;
  // A second dangling-edge pass cleans up any edges left by stale file node removal
  if (staleFileNodesRemoved > 0) pruneDanglingEdges(db);
  return { danglingEdgesRemoved, orphanNodesRemoved, staleFileNodesRemoved };
}

/**
 * Format a PruneResult as structured text for LLM consumption.
 */
export function formatPruneResult(result: PruneResult): string {
  const total = result.danglingEdgesRemoved + result.orphanNodesRemoved + result.staleFileNodesRemoved;
  if (total === 0) return 'Prune pass: nothing to remove — graph is clean.';
  return [
    `Prune pass removed ${total} artifact(s):`,
    `  dangling edges:    ${result.danglingEdgesRemoved}`,
    `  orphan nodes:      ${result.orphanNodesRemoved}`,
    `  stale file nodes:  ${result.staleFileNodesRemoved}`,
  ].join('\n');
}
