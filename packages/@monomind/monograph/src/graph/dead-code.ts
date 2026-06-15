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
  return detectDeadCodeNodes(db).map(n => n.id);
}

// ---------------------------------------------------------------------------

export interface DeadCodeNode {
  id: string;
  name: string;
  filePath: string | null;
  startLine: number | null;
  label: string;
}

/**
 * Like detectDeadCode() but returns rich node objects with filePath and
 * startLine so callers can render file:line navigation hints.
 *
 * @param db - The MonographDb instance
 * @returns Array of dead-code nodes with location metadata.
 */
export function detectDeadCodeNodes(db: MonographDb): DeadCodeNode[] {
  const nodeRows = db
    .prepare('SELECT id, name, file_path, start_line, label, is_exported FROM nodes')
    .all() as {
    id: string;
    name: string;
    file_path: string | null;
    start_line: number | null;
    label: string;
    is_exported: number;
  }[];

  if (nodeRows.length === 0) return [];

  // Count in-degrees via a single SQL aggregation — avoids loading all edges into JS
  const inDegreeRows = db
    .prepare(
      'SELECT target_id, COUNT(*) AS cnt FROM edges WHERE source_id != target_id GROUP BY target_id',
    )
    .all() as { target_id: string; cnt: number }[];

  const inDegree = new Map<string, number>();
  for (const { target_id, cnt } of inDegreeRows) {
    inDegree.set(target_id, cnt);
  }

  const dead: DeadCodeNode[] = [];
  for (const row of nodeRows) {
    if ((inDegree.get(row.id) ?? 0) === 0 && row.is_exported !== 1) {
      dead.push({
        id: row.id,
        name: row.name,
        filePath: row.file_path,
        startLine: row.start_line,
        label: row.label,
      });
    }
  }

  return dead;
}

/**
 * Format dead-code nodes as structured text for LLM consumption.
 * Each entry includes a file:line navigation hint where available.
 *
 * @param nodes - Result from detectDeadCodeNodes()
 * @returns Multi-line string suitable for injection into LLM context
 */
export function formatDeadCode(nodes: DeadCodeNode[]): string {
  if (nodes.length === 0) {
    return 'Dead code: none detected.';
  }

  const lines: string[] = [
    `Dead code: ${nodes.length} unreachable node${nodes.length === 1 ? '' : 's'} detected`,
    '',
  ];

  for (const node of nodes) {
    const loc =
      node.filePath != null
        ? node.startLine != null
          ? `${node.filePath}:${node.startLine}`
          : node.filePath
        : '(unknown location)';
    lines.push(`  [${node.label}] ${node.name} — ${loc}`);
  }

  return lines.join('\n');
}
