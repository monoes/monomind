/**
 * Cluster quality metrics: silhouette score and modularity score.
 *
 * References:
 *  - Silhouette: Rousseeuw (1987) — (b-a)/max(a,b) averaged over all nodes
 *  - Modularity: Newman & Girvan (2004) — Q = Σ[e_ii - a_i²]
 */

export type Edge = { sourceId: string; targetId: string };

/**
 * Build an adjacency map from an edge list (undirected).
 */
function buildAdjacency(edges: Edge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const { sourceId, targetId } of edges) {
    if (!adj.has(sourceId)) adj.set(sourceId, new Set());
    if (!adj.has(targetId)) adj.set(targetId, new Set());
    adj.get(sourceId)!.add(targetId);
    adj.get(targetId)!.add(sourceId);
  }
  return adj;
}

/**
 * Average hop-distance proxy: fraction of community members NOT adjacent to node.
 * For graph-based silhouette we use the complement of the adjacency fraction
 * as a distance (0 = neighbor, 1 = no edge).
 *
 * a(i) = mean distance to other nodes in same community
 * b(i) = min mean distance to any other community
 * silhouette(i) = (b(i) - a(i)) / max(a(i), b(i))
 *
 * @param communityMembers - precomputed communityId → nodeId[] map (excludes self)
 */
function nodeSilhouette(
  nodeId: string,
  community: number,
  communityMembers: Map<number, string[]>,
  adj: Map<string, Set<string>>,
): number {
  const neighbors = adj.get(nodeId) ?? new Set<string>();

  const sameMembers = (communityMembers.get(community) ?? []).filter(n => n !== nodeId);
  if (sameMembers.length === 0) return 0; // singleton community

  // a(i): mean distance to same community (1 = not neighbor, 0 = neighbor)
  const a =
    sameMembers.reduce((sum, nid) => sum + (neighbors.has(nid) ? 0 : 1), 0) /
    sameMembers.length;

  // b(i): minimum mean distance to any other community
  let b = Infinity;
  for (const [cid, members] of communityMembers) {
    if (cid === community || members.length === 0) continue;
    const meanDist =
      members.reduce((sum, nid) => sum + (neighbors.has(nid) ? 0 : 1), 0) /
      members.length;
    if (meanDist < b) b = meanDist;
  }

  if (!isFinite(b)) return 0; // only one community exists
  const denom = Math.max(a, b);
  if (denom === 0) return 0;
  return (b - a) / denom;
}

/**
 * Compute the average silhouette score for the partitioning.
 * Returns a value in [-1, 1] where higher is better.
 *
 * Precomputes the communityMembers map once (O(N)) before the per-node loop,
 * reducing overall complexity from O(N²) to O(N + K*N) where K = community count.
 */
export function silhouetteScore(
  memberships: Map<string, number>,
  edges: Edge[],
): number {
  if (memberships.size === 0) return 0;
  const adj = buildAdjacency(edges);

  // Precompute communityId → nodeId[] once to avoid O(N) re-scan per node
  const communityMembers = new Map<number, string[]>();
  for (const [nid, cid] of memberships) {
    let members = communityMembers.get(cid);
    if (!members) {
      members = [];
      communityMembers.set(cid, members);
    }
    members.push(nid);
  }

  let total = 0;
  for (const [nodeId, community] of memberships) {
    total += nodeSilhouette(nodeId, community, communityMembers, adj);
  }
  return total / memberships.size;
}

/**
 * Compute Newman–Girvan modularity Q using the community-level formula:
 *   Q = Σ_c [e_c / m - (a_c / 2m)²]
 * where e_c = intra-community edges, a_c = sum of degrees in community c, m = total edges.
 *
 * O(E + N) instead of O(N²).
 * Returns a value in (-0.5, 1].
 */
export function modularityScore(
  memberships: Map<string, number>,
  edges: Edge[],
): number {
  if (edges.length === 0 || memberships.size === 0) return 0;

  const adj = buildAdjacency(edges);
  const m = edges.length; // directed edges count (each undirected pair counted once in input)

  // Sum of degrees per community and intra-community edge count
  const communityDegreeSum = new Map<number, number>();
  const intraCommunityEdges = new Map<number, number>();

  for (const [nodeId, cid] of memberships) {
    const deg = adj.get(nodeId)?.size ?? 0;
    communityDegreeSum.set(cid, (communityDegreeSum.get(cid) ?? 0) + deg);
  }

  for (const { sourceId, targetId } of edges) {
    const cs = memberships.get(sourceId);
    const ct = memberships.get(targetId);
    if (cs !== undefined && ct !== undefined && cs === ct) {
      intraCommunityEdges.set(cs, (intraCommunityEdges.get(cs) ?? 0) + 1);
    }
  }

  const twoM = 2 * m;
  let Q = 0;
  for (const [cid, degSum] of communityDegreeSum) {
    const ec = intraCommunityEdges.get(cid) ?? 0;
    Q += ec / m - (degSum / twoM) ** 2;
  }

  return Q;
}
