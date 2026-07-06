import type { MonographDb } from '../storage/db.js';

/**
 * Detect dead code: exported top-level functions with zero inbound references.
 *
 * Limited to Function nodes only — the graph tracks CALLS edges for functions
 * but has near-zero coverage for Interface/TypeAlias/Class usage.
 *
 * Filters:
 * - Only top-level functions (File CONTAINS node) — skips nested closures
 * - Only exported — private locals are internal by design
 * - Skips entry-point, test, dist, and node_modules paths
 * - Requires zero inbound CALLS, IMPORTS, REFERENCES, and RE_EXPORTS edges
 * - No same-name node in another file (catches import bindings)
 * - Not re-exported through any index.ts barrel file
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

export function detectDeadCodeNodes(db: MonographDb): DeadCodeNode[] {
  // monolean: only Function — graph lacks edges for Interface/TypeAlias/Class usage
  const rows = db
    .prepare(
      `SELECT n.id, n.name, n.file_path, n.start_line, n.label
       FROM nodes n
       WHERE n.is_exported = 1
         AND n.label = 'Function'
         AND n.file_path IS NOT NULL
         AND n.file_path NOT LIKE '%/dist/%'
         AND n.file_path NOT LIKE '%node_modules%'
         AND n.file_path NOT LIKE '%__tests__%'
         AND n.file_path NOT LIKE '%.test.%'
         AND n.file_path NOT LIKE '%.spec.%'
         AND n.file_path NOT LIKE '%/index.%'
         AND n.file_path NOT LIKE 'bin/%'
         AND n.file_path NOT LIKE '%/cli.ts'
         AND n.file_path NOT LIKE '%/main.ts'
         -- top-level only: parent is a File node
         AND EXISTS (
           SELECT 1 FROM edges e
           JOIN nodes p ON e.source_id = p.id
           WHERE e.target_id = n.id AND e.relation = 'CONTAINS' AND p.label = 'File'
         )
         -- no inbound usage edges of any kind
         AND NOT EXISTS (
           SELECT 1 FROM edges e
           WHERE e.target_id = n.id
             AND e.relation IN ('CALLS', 'IMPORTS', 'REFERENCES', 'RE_EXPORTS')
         )
         -- no same-name node in another file (import bindings, .cjs callers, etc.)
         AND NOT EXISTS (
           SELECT 1 FROM nodes o
           WHERE o.name = n.name AND o.file_path != n.file_path
             AND o.file_path IS NOT NULL
             AND o.file_path NOT LIKE '%/dist/%'
             AND o.file_path NOT LIKE '%node_modules%'
         )
         -- not re-exported through a barrel (index.ts/index.js)
         AND NOT EXISTS (
           SELECT 1 FROM nodes b
           WHERE b.name = n.name
             AND b.file_path LIKE '%/index.%'
             AND b.file_path NOT LIKE '%/dist/%'
             AND b.file_path NOT LIKE '%node_modules%'
         )
       ORDER BY n.file_path, n.start_line`,
    )
    .all() as {
    id: string;
    name: string;
    file_path: string | null;
    start_line: number | null;
    label: string;
  }[];

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    filePath: r.file_path,
    startLine: r.start_line,
    label: r.label,
  }));
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
    `Dead code candidates: ${nodes.length} exported function${nodes.length === 1 ? '' : 's'} with no graph references`,
    '(Candidates only — verify with grep before removing)',
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
