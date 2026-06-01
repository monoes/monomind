import type { MonographDb } from '../storage/db.js';

export interface TopoSortResult {
  /** Groups of nodes that can be processed independently at each level.
   *  Level 0 = leaves (nodes with no outgoing IMPORTS edges on the reverse graph).
   *  Higher levels depend on previous levels. Cycle nodes are appended last. */
  levels: string[][];
  /** Number of nodes that are part of a cycle and could not be sorted. */
  cycleCount: number;
}

/**
 * Topological level sort using Kahn's algorithm on the *reverse* import graph.
 *
 * In the reverse graph, an edge A→B in the original (A imports B) becomes B→A.
 * Files with no incoming edges on the reverse graph (i.e., no one imports them)
 * are leaves and appear in level 0.
 *
 * @param db - The MonographDb instance
 * @returns Object with `levels` (array of independent groups, leaf-first) and `cycleCount`.
 */
export function topologicalLevelSort(db: MonographDb): TopoSortResult {
  const nodeRows = db.prepare('SELECT id FROM nodes').all() as { id: string }[];
  const edgeRows = db.prepare('SELECT source_id, target_id FROM edges').all() as {
    source_id: string;
    target_id: string;
  }[];

  if (nodeRows.length === 0) return { levels: [], cycleCount: 0 };

  const nodes = nodeRows.map(r => r.id);

  // Build reverse graph: original edge src→tgt becomes tgt→src in reverse
  // In-degree in the reverse graph = number of nodes that tgt imports (out-degree in original)
  const reverseAdj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const n of nodes) {
    reverseAdj.set(n, []);
    inDegree.set(n, 0);
  }

  for (const { source_id: src, target_id: tgt } of edgeRows) {
    if (src === tgt) continue; // skip self-loops
    if (!reverseAdj.has(tgt) || !reverseAdj.has(src)) continue;
    reverseAdj.get(tgt)!.push(src);
    inDegree.set(src, (inDegree.get(src) ?? 0) + 1);
  }

  // Kahn's BFS on the reverse graph
  const queue: string[] = [];
  for (const [node, deg] of inDegree) {
    if (deg === 0) queue.push(node);
  }

  const levels: string[][] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    // All nodes currently at in-degree 0 form one level
    const level = [...queue];
    queue.length = 0;
    levels.push(level);

    for (const node of level) {
      visited.add(node);
      for (const neighbor of reverseAdj.get(node) ?? []) {
        if (visited.has(neighbor)) continue;
        const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }
  }

  // Remaining unvisited nodes are in cycles
  const cycleNodes = nodes.filter(n => !visited.has(n));
  let cycleCount = 0;

  if (cycleNodes.length > 0) {
    cycleCount = cycleNodes.length;
    levels.push(cycleNodes);
  }

  return { levels, cycleCount };
}
