import type { MonographDb } from '../storage/db.js';
import type { AnnotatedFinding } from '../types.js';

export interface CrossReferenceFinding extends AnnotatedFinding {
  crossRefType: 'dead+duplicate';
  nodeIds: string[];
  description: string;
}

export interface CrossReferenceReport {
  findings: CrossReferenceFinding[];
  deadCount: number;
  duplicateCount: number;
  crossCount: number;   // nodes that are BOTH dead AND duplicated
}

/**
 * Cross-reference unreachable files with duplicated files.
 * Files that are BOTH dead code AND structurally duplicated are
 * the highest-confidence safe-delete candidates.
 *
 * @param db - monograph database
 */
export function crossReferenceDuplicatesAndDeadCode(db: MonographDb): CrossReferenceReport {
  // ── Step 1: Find dead (unreachable) file nodes ────────────────────────────
  const deadRows = db.prepare(`
    SELECT id, name, file_path
    FROM nodes
    WHERE label = 'File'
      AND json_extract(properties, '$.reachabilityRole') = 'unreachable'
  `).all() as { id: string; name: string; file_path: string | null }[];

  const deadIds = new Set(deadRows.map(r => r.id));
  const deadById = new Map(deadRows.map(r => [r.id, r]));

  // ── Step 2: Find duplicated file nodes ───────────────────────────────────
  // Primary: nodes connected by STRUCTURALLY_SIMILAR edges
  let duplicateIds = new Set<string>();

  try {
    const simRows = db.prepare(`
      SELECT source_id, target_id
      FROM edges
      WHERE relation = 'STRUCTURALLY_SIMILAR'
    `).all() as { source_id: string; target_id: string }[];

    for (const row of simRows) {
      duplicateIds.add(row.source_id);
      duplicateIds.add(row.target_id);
    }
  } catch {
    // relation may not exist in this graph
  }

  // Fallback: files with the same basename in multiple directories
  if (duplicateIds.size === 0) {
    const allFiles = db.prepare(`
      SELECT id, file_path
      FROM nodes
      WHERE label = 'File' AND file_path IS NOT NULL
    `).all() as { id: string; file_path: string }[];

    const byBasename = new Map<string, string[]>();
    for (const { id, file_path } of allFiles) {
      const lastSlash = Math.max(file_path.lastIndexOf('/'), file_path.lastIndexOf('\\'));
      const base = lastSlash === -1 ? file_path : file_path.slice(lastSlash + 1);
      if (!byBasename.has(base)) byBasename.set(base, []);
      byBasename.get(base)!.push(id);
    }

    for (const ids of byBasename.values()) {
      if (ids.length > 1) {
        for (const id of ids) duplicateIds.add(id);
      }
    }
  }

  // ── Step 3: Cross-reference ──────────────────────────────────────────────
  const crossIds: string[] = [];
  for (const id of deadIds) {
    if (duplicateIds.has(id)) crossIds.push(id);
  }

  // ── Step 4: Build findings ───────────────────────────────────────────────
  const findings: CrossReferenceFinding[] = crossIds.map(id => {
    const node = deadById.get(id)!;
    return {
      crossRefType: 'dead+duplicate',
      nodeIds: [id],
      description: `File "${node.name}" is both unreachable (dead code) and structurally duplicated — highest-confidence safe-delete candidate.`,
      title: 'Unreachable duplicate file',
      severity: 'warning',
      nodeId: id,
      nodeName: node.name,
      filePath: node.file_path,
      actions: [
        {
          type: 'delete',
          file: node.file_path ?? undefined,
          description: 'Safe to remove — file is both unreachable and duplicated',
          confidence: 'high',
        },
      ],
    };
  });

  return {
    findings,
    deadCount: deadIds.size,
    duplicateCount: duplicateIds.size,
    crossCount: crossIds.length,
  };
}
