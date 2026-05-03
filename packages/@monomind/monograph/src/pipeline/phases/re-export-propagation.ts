import type { PipelinePhase, PipelineContext } from '../types.js';
import { makeId, CONFIDENCE_SCORE } from '../../types.js';
import { insertEdges } from '../../storage/edge-store.js';
import type Database from 'better-sqlite3';

export interface ReExportPropagationOutput {
  propagated: number;
}

/**
 * Fixed-point re-export chain propagation.
 *
 * After the graph is built, barrel files (index.ts that re-export from sub-modules)
 * create RE_EXPORTS edges pointing to the files they re-export from. A file is
 * "reachable" if:
 *   (a) it has a direct IMPORTS edge targeting one of its symbols or its File node, OR
 *   (b) it is re-exported by a barrel file that is itself reachable (transitively).
 *
 * This prevents false "unreachable" reports for exports behind barrel files.
 *
 * Algorithm: iterative BFS until no new propagations (fixed-point).
 */
export function propagateReExports(db: Database.Database): ReExportPropagationOutput {
  // Collect all RE_EXPORTS edges (barrel file → re-exported file), keyed by File node IDs
  const reExportEdges = db.prepare(
    `SELECT source_id, target_id FROM edges WHERE relation = 'RE_EXPORTS'`,
  ).all() as { source_id: string; target_id: string }[];

  if (reExportEdges.length === 0) return { propagated: 0 };

  // Build map: barrelFileId → Set<reExportedFileId>
  const barrelExports = new Map<string, Set<string>>();
  for (const e of reExportEdges) {
    if (!barrelExports.has(e.source_id)) barrelExports.set(e.source_id, new Set());
    barrelExports.get(e.source_id)!.add(e.target_id);
  }

  // Determine which File nodes are "reached" — either directly imported (via their File node ID)
  // or their symbols are imported (join through nodes.file_path).
  // We build a set of reached file paths to handle both IMPORTS→symbol and IMPORTS→File cases.
  const reachedFilePaths = new Set<string>(
    (db.prepare(`
      SELECT DISTINCT n.file_path
      FROM edges e
      JOIN nodes n ON n.id = e.target_id
      WHERE e.relation = 'IMPORTS'
        AND n.file_path IS NOT NULL
    `).all() as { file_path: string }[]).map(r => r.file_path),
  );

  // Also map File node ID → file_path for barrel lookup
  const fileIdToPath = new Map<string, string>(
    (db.prepare(`SELECT id, file_path FROM nodes WHERE label = 'File' AND file_path IS NOT NULL`).all() as
      { id: string; file_path: string }[]).map(r => [r.id, r.file_path]),
  );

  // Map file_path → File node ID for inserting synthetic IMPORTS edges
  const filePathToId = new Map<string, string>();
  for (const [id, path] of fileIdToPath) filePathToId.set(path, id);

  // Prepare insert for synthetic IMPORTS edge: importer_file → re-exported_file (File node)
  const insertEdge = db.prepare(`
    INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score, weight)
    VALUES (?, ?, ?, 'IMPORTS', 'INFERRED', ?, 1.0)
  `);

  const addPropagated = db.transaction(
    (toAdd: Array<{ importerFileId: string; targetFileId: string; targetFilePath: string }>) => {
      for (const { importerFileId, targetFileId, targetFilePath } of toAdd) {
        const edgeId = makeId(importerFileId, targetFileId, 'reexport_propagated');
        insertEdge.run(edgeId, importerFileId, targetFileId, CONFIDENCE_SCORE.INFERRED);
        reachedFilePaths.add(targetFilePath);
      }
    },
  );

  let totalPropagated = 0;
  let changed = true;

  while (changed) {
    changed = false;
    const toAdd: Array<{ importerFileId: string; targetFileId: string; targetFilePath: string }> = [];

    for (const [barrelFileId, exportedFileIds] of barrelExports) {
      const barrelFilePath = fileIdToPath.get(barrelFileId);
      if (!barrelFilePath || !reachedFilePaths.has(barrelFilePath)) continue;

      // Find who imports this barrel (via its File node or via its symbols)
      const importers = db.prepare(`
        SELECT DISTINCT e.source_id
        FROM edges e
        WHERE e.relation = 'IMPORTS'
          AND e.target_id IN (
            SELECT id FROM nodes
            WHERE file_path = ?
          )
      `).all(barrelFilePath) as { source_id: string }[];

      for (const { source_id: importerNodeId } of importers) {
        // Walk up to the importing File node
        const importerFilePath = (db.prepare(
          `SELECT file_path FROM nodes WHERE id = ? AND file_path IS NOT NULL LIMIT 1`,
        ).get(importerNodeId) as { file_path: string } | null)?.file_path;

        const importerFileId = importerFilePath ? filePathToId.get(importerFilePath) : undefined;
        if (!importerFileId) continue;

        for (const targetFileId of exportedFileIds) {
          const targetFilePath = fileIdToPath.get(targetFileId);
          if (!targetFilePath) continue;

          if (!reachedFilePaths.has(targetFilePath)) {
            toAdd.push({ importerFileId, targetFileId, targetFilePath });
          }
        }
      }
    }

    if (toAdd.length > 0) {
      addPropagated(toAdd);
      totalPropagated += toAdd.length;
      changed = true;
    }
  }

  return { propagated: totalPropagated };
}

export const reExportPropagationPhase: PipelinePhase<ReExportPropagationOutput> = {
  name: 're-export-propagation',
  deps: ['cross-file'],
  async execute(ctx): Promise<ReExportPropagationOutput> {
    if (!ctx.db) return { propagated: 0 };
    const result = propagateReExports(ctx.db);
    ctx.onProgress?.({ phase: 're-export-propagation', message: `Propagated ${result.propagated} re-export edges` });
    return result;
  },
};
