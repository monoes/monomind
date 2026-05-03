import { relative } from 'path';
import type { MonographDb } from '../storage/db.js';

function relPath(filePath: string, repoRoot?: string): string {
  if (!repoRoot) return filePath;
  return relative(repoRoot, filePath);
}

/**
 * Export a compact one-line-per-issue text format suitable for CLI output
 * and machine consumption by shell pipelines.
 *
 * Line formats:
 *   unreachable-file:{path}
 *   god-node:{path}:{line}:{name}
 *   duplicate:{path}:{name}
 *   boundary-violation:{path}:{line}:{rule}
 */
export function exportCompact(db: MonographDb, repoRoot?: string): string {
  const lines: string[] = [];

  // ── Unreachable files ──────────────────────────────────────────────────────
  const unreachable = db.prepare(`
    SELECT file_path FROM nodes
    WHERE label = 'File'
    AND (
      json_extract(properties, '$.reachabilityRole') = 'unreachable'
      OR properties LIKE '%"unreachable"%'
    )
    AND file_path IS NOT NULL
  `).all() as { file_path: string }[];

  for (const row of unreachable) {
    lines.push(`unreachable-file:${relPath(row.file_path, repoRoot)}`);
  }

  // ── God nodes (top 10% by fan-in) ─────────────────────────────────────────
  const totalNodes = (db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE label = 'File'`).get() as { c: number }).c;
  const top10pct = Math.max(1, Math.floor(totalNodes * 0.1));
  const godNodes = db.prepare(`
    SELECT n.name, n.file_path, COALESCE(n.start_line, 1) AS line,
           COUNT(e.id) AS in_degree
    FROM nodes n
    LEFT JOIN edges e ON e.target_id = n.id
    WHERE n.file_path IS NOT NULL AND n.label = 'File'
    GROUP BY n.id
    ORDER BY in_degree DESC
    LIMIT ?
  `).all(top10pct) as { name: string; file_path: string; line: number; in_degree: number }[];

  for (const row of godNodes) {
    if (row.in_degree === 0) continue;
    lines.push(`god-node:${relPath(row.file_path, repoRoot)}:${row.line}:${row.name}`);
  }

  // ── Structural duplicates ─────────────────────────────────────────────────
  const dupes = db.prepare(`
    SELECT n1.name AS src_name, n1.file_path AS src_path
    FROM edges e
    JOIN nodes n1 ON n1.id = e.source_id
    WHERE e.relation = 'STRUCTURALLY_SIMILAR'
    AND n1.file_path IS NOT NULL
  `).all() as { src_name: string; src_path: string }[];

  for (const row of dupes) {
    lines.push(`duplicate:${relPath(row.src_path, repoRoot)}:${row.src_name}`);
  }

  // ── Boundary violations (stored in node properties) ───────────────────────
  const violations = db.prepare(`
    SELECT file_path, COALESCE(start_line, 1) AS line,
           json_extract(properties, '$.boundaryViolation') AS rule
    FROM nodes
    WHERE file_path IS NOT NULL
    AND json_extract(properties, '$.boundaryViolation') IS NOT NULL
  `).all() as { file_path: string; line: number; rule: string }[];

  for (const row of violations) {
    lines.push(`boundary-violation:${relPath(row.file_path, repoRoot)}:${row.line}:${row.rule}`);
  }

  return lines.join('\n');
}
