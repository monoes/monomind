import type { MonographDb } from '../storage/db.js';

export interface ImportChainOptions {
  /** Maximum path depth. Default: 10 */
  maxDepth?: number;
  /** Maximum number of paths to return (prevents explosion). Default: 100 */
  maxPaths?: number;
}

/**
 * Trace all import chains (paths) from `sourceId` to `targetId`.
 *
 * Uses BFS/DFS with cycle detection. Returns all simple paths up to `maxDepth`.
 *
 * @param db - The MonographDb instance
 * @param sourceId - Starting node id
 * @param targetId - Destination node id
 * @param options - Optional tuning parameters
 * @returns Array of paths; each path is an ordered array of node ids from source to target.
 */
export function traceImportChain(
  db: MonographDb,
  sourceId: string,
  targetId: string,
  options: ImportChainOptions = {},
): string[][] {
  const { maxDepth = 10, maxPaths = 100 } = options;

  const nodeRows = db.prepare('SELECT id FROM nodes').all() as { id: string }[];
  if (nodeRows.length === 0) return [];

  const nodeSet = new Set(nodeRows.map(r => r.id));
  if (!nodeSet.has(sourceId) || !nodeSet.has(targetId)) return [];
  if (sourceId === targetId) return [[sourceId]];

  const edgeRows = db.prepare('SELECT source_id, target_id FROM edges').all() as {
    source_id: string;
    target_id: string;
  }[];

  // Build adjacency
  const adj = new Map<string, string[]>();
  for (const n of nodeSet) adj.set(n, []);
  for (const { source_id: src, target_id: tgt } of edgeRows) {
    if (src === tgt) continue;
    if (!adj.has(src) || !adj.has(tgt)) continue;
    adj.get(src)!.push(tgt);
  }

  // DFS with path tracking
  const results: string[][] = [];
  const stack: Array<{ node: string; path: string[]; visited: Set<string> }> = [
    { node: sourceId, path: [sourceId], visited: new Set([sourceId]) },
  ];

  while (stack.length > 0 && results.length < maxPaths) {
    const { node, path, visited } = stack.pop()!;
    // path.length includes the source node, so depth = path.length - 1
    // Use > (not >=) so paths of exactly maxDepth edges are explored
    if (path.length - 1 > maxDepth) continue;

    for (const neighbor of adj.get(node) ?? []) {
      if (visited.has(neighbor)) continue;
      if (neighbor === targetId) {
        results.push([...path, neighbor]);
        if (results.length >= maxPaths) break;
      } else {
        stack.push({
          node: neighbor,
          path: [...path, neighbor],
          visited: new Set([...visited, neighbor]),
        });
      }
    }
  }

  return results;
}
