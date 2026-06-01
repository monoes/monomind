/**
 * Ripple / cascade impact analysis.
 *
 * Given a starting node, perform a multi-hop BFS through *directed* edges and
 * compute how far a change can propagate.  Each depth level is assigned a
 * decaying weight so that direct dependents (depth 1) contribute more to the
 * totalScore than transitive dependents.
 *
 * Default decay factor: 0.5 per hop (configurable).
 */

export interface RippleEdge {
  sourceId: string;
  targetId: string;
}

export interface RippleResult {
  /** Nodes reachable at each depth, starting at depth 1 (direct neighbors). */
  byDepth: Record<number, string[]>;
  /** Weighted sum: Σ(count_at_depth * decay^depth). */
  totalScore: number;
}

/**
 * Compute the ripple impact of changing `startNodeId`.
 *
 * @param startNodeId  The node whose change we are propagating.
 * @param edges        Directed edges in the graph.
 * @param maxDepth     Maximum BFS depth (default 3).
 * @param decayFactor  Weight multiplier per depth level (default 0.5).
 */
export function rippleImpact(
  startNodeId: string,
  edges: RippleEdge[],
  maxDepth = 3,
  decayFactor = 0.5,
): RippleResult {
  // Build directed adjacency (source → targets)
  const outgoing = new Map<string, string[]>();
  for (const { sourceId, targetId } of edges) {
    if (!outgoing.has(sourceId)) outgoing.set(sourceId, []);
    outgoing.get(sourceId)!.push(targetId);
  }

  if (!outgoing.has(startNodeId)) {
    return { byDepth: {}, totalScore: 0 };
  }

  const visited = new Set<string>([startNodeId]);
  const byDepth: Record<number, string[]> = {};
  let frontier = [startNodeId];
  let totalScore = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextFrontier: string[] = [];
    for (const node of frontier) {
      for (const neighbor of outgoing.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }
    if (nextFrontier.length === 0) break;
    byDepth[depth] = nextFrontier;
    totalScore += nextFrontier.length * Math.pow(decayFactor, depth);
    frontier = nextFrontier;
  }

  return { byDepth, totalScore };
}
