export interface DfsNode {
  id: string;
  depth: number;
}

export interface DfsOptions {
  maxDepth?: number;
}

export interface DfsResult {
  visited: DfsNode[];
  maxDepth: number;
  nodeCount: number;
}

export function dfsTraversal(
  startId: string,
  adjacency: Map<string, string[]>,
  visitor: (node: DfsNode) => void,
  options: DfsOptions = {},
): void {
  if (!adjacency.has(startId)) return;

  const { maxDepth = Infinity } = options;
  const visited = new Set<string>();
  const stack: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

  while (stack.length > 0) {
    const { id, depth } = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);

    visitor({ id, depth });

    if (depth < maxDepth) {
      const neighbors = adjacency.get(id) ?? [];
      // Push in reverse order so left-most neighbor is processed first (DFS left-to-right order)
      for (let i = neighbors.length - 1; i >= 0; i--) {
        const neighbor = neighbors[i]!;
        if (!visited.has(neighbor)) {
          stack.push({ id: neighbor, depth: depth + 1 });
        }
      }
    }
  }
}

/** Collect all reachable nodes from startId via DFS, returning structured result. */
export function dfsCollect(
  startId: string,
  adjacency: Map<string, string[]>,
  options: DfsOptions = {},
): DfsResult {
  const visited: DfsNode[] = [];
  let maxReachedDepth = 0;
  dfsTraversal(startId, adjacency, (node) => {
    visited.push(node);
    if (node.depth > maxReachedDepth) maxReachedDepth = node.depth;
  }, options);
  return { visited, maxDepth: maxReachedDepth, nodeCount: visited.length };
}

/** BFS level-order traversal — useful when shortest-path distance matters more than DFS order. */
export function bfsTraversal(
  startId: string,
  adjacency: Map<string, string[]>,
  visitor: (node: DfsNode) => void,
  options: DfsOptions = {},
): void {
  if (!adjacency.has(startId)) return;

  const { maxDepth = Infinity } = options;
  const visited = new Set<string>([startId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    visitor({ id, depth });

    if (depth < maxDepth) {
      const neighbors = adjacency.get(id) ?? [];
      for (let i = 0; i < neighbors.length; i++) {
        const neighbor = neighbors[i]!;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ id: neighbor, depth: depth + 1 });
        }
      }
    }
  }
}

/**
 * Format a DfsResult as structured text for LLM consumption.
 * Groups nodes by depth level for easy reading.
 */
export function formatDfsResult(result: DfsResult, startId: string): string {
  if (result.nodeCount === 0) return `No nodes reachable from "${startId}".`;

  const byDepth = new Map<number, string[]>();
  for (const node of result.visited) {
    let bucket = byDepth.get(node.depth);
    if (!bucket) { bucket = []; byDepth.set(node.depth, bucket); }
    bucket.push(node.id);
  }

  const lines: string[] = [
    `DFS from "${startId}": ${result.nodeCount} nodes, max depth ${result.maxDepth}`,
    '',
  ];
  // Iterate in depth order
  const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
  for (const depth of depths) {
    const ids = byDepth.get(depth)!;
    lines.push(`  depth ${depth}: ${ids.join(', ')}`);
  }
  return lines.join('\n');
}
