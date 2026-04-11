import type Graph from 'graphology';

/**
 * Run Louvain community detection on the graph.
 * Assigns the `community` attribute to each node in-place.
 * Returns a map from communityId → list of nodeIds.
 */
export async function detectCommunities(graph: Graph): Promise<Record<number, string[]>> {
  try {
    const { default: louvain } = await import('graphology-communities-louvain');
    const assignment = louvain(graph) as Record<string, number>;

    // Write community id back onto each node
    for (const [nodeId, communityId] of Object.entries(assignment)) {
      graph.setNodeAttribute(nodeId, 'community', communityId);
    }

    // Build communityId → members map
    const communities: Record<number, string[]> = {};
    for (const [nodeId, communityId] of Object.entries(assignment)) {
      if (!communities[communityId]) communities[communityId] = [];
      communities[communityId].push(nodeId);
    }
    return communities;
  } catch {
    // Louvain unavailable — fall back to directory-based clustering
    return fallbackCluster(graph);
  }
}

/**
 * Fallback: group nodes by the directory portion of their sourceFile attribute.
 * Deterministic and zero-dependency.
 */
function fallbackCluster(graph: Graph): Record<number, string[]> {
  const dirMap = new Map<string, number>();
  let nextId = 0;
  const communities: Record<number, string[]> = {};

  graph.forEachNode((id, attrs) => {
    const file = (attrs.sourceFile as string) || '';
    const parts = file.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root';

    if (!dirMap.has(dir)) dirMap.set(dir, nextId++);
    const cid = dirMap.get(dir)!;

    graph.setNodeAttribute(id, 'community', cid);
    if (!communities[cid]) communities[cid] = [];
    communities[cid].push(id);
  });

  return communities;
}
