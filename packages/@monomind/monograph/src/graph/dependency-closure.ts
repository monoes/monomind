import type { MonographDb } from '../storage/db.js';

export interface DepClosureResult {
  nodeId: string;
  name: string;
  filePath: string | null;
  directDeps: string[];           // IDs of directly imported nodes
  transitiveDeps: string[];       // IDs of all transitively imported nodes
  depDepth: number;               // max dependency chain depth
  unusedTransitiveDeps: string[]; // transitive deps that are never directly referenced by any file in the project
}

export interface DepClosureReport {
  nodes: DepClosureResult[];
  avgDepDepth: number;
  maxDepDepth: number;
  deepDependencyFiles: DepClosureResult[];   // files with depDepth > 5
}

export function computeDependencyClosure(db: MonographDb, maxNodes = 100): DepClosureReport {
  // Get File nodes sorted by degree (most connected first)
  const fileNodes = (db.prepare(`
    SELECT n.id, n.name, n.file_path,
      (SELECT COUNT(*) FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id) AS degree
    FROM nodes n
    WHERE n.label = 'File'
    ORDER BY degree DESC
    LIMIT ?
  `).all(maxNodes) as Array<{ id: string; name: string; file_path: string | null; degree: number }>);

  // Build a set of all file_paths that have any IMPORTS edge pointing to them (are imported by someone)
  const importedFilePaths = new Set<string>(
    (db.prepare(`
      SELECT DISTINCT n.file_path
      FROM edges e
      JOIN nodes n ON n.id = e.target_id
      WHERE e.relation = 'IMPORTS' AND n.file_path IS NOT NULL
    `).all() as Array<{ file_path: string }>).map(r => r.file_path)
  );

  const results: DepClosureResult[] = [];

  for (const fileNode of fileNodes) {
    // BFS forward (following IMPORTS edges from this node)
    const directDeps: string[] = [];
    const transitiveDeps: string[] = [];
    const visited = new Set<string>([fileNode.id]);
    let frontier = [fileNode.id];
    let depth = 0;
    let maxDepth = 0;

    while (frontier.length > 0) {
      depth++;
      const next: string[] = [];
      for (const id of frontier) {
        const edges = db.prepare(
          `SELECT target_id FROM edges WHERE source_id = ? AND relation = 'IMPORTS'`
        ).all(id) as Array<{ target_id: string }>;

        for (const e of edges) {
          if (!visited.has(e.target_id)) {
            visited.add(e.target_id);
            next.push(e.target_id);
            if (depth === 1) {
              directDeps.push(e.target_id);
            } else {
              transitiveDeps.push(e.target_id);
            }
            maxDepth = depth;
          }
        }
      }
      frontier = next;
    }

    // unusedTransitiveDeps: transitive deps whose file_path is NOT in importedFilePaths
    const unusedTransitiveDeps = transitiveDeps.filter(depId => {
      const depNode = db.prepare('SELECT file_path FROM nodes WHERE id = ?').get(depId) as { file_path: string | null } | undefined;
      if (!depNode?.file_path) return false;
      return !importedFilePaths.has(depNode.file_path);
    });

    results.push({
      nodeId: fileNode.id,
      name: fileNode.name,
      filePath: fileNode.file_path,
      directDeps,
      transitiveDeps,
      depDepth: maxDepth,
      unusedTransitiveDeps,
    });
  }

  // Sort by depDepth descending
  results.sort((a, b) => b.depDepth - a.depDepth);

  const avgDepDepth = results.length > 0
    ? results.reduce((sum, r) => sum + r.depDepth, 0) / results.length
    : 0;
  const maxDepDepth = results.length > 0 ? results[0].depDepth : 0;
  const deepDependencyFiles = results.filter(r => r.depDepth > 5);

  return {
    nodes: results,
    avgDepDepth: Math.round(avgDepDepth * 100) / 100,
    maxDepDepth,
    deepDependencyFiles,
  };
}
