import type Graph from 'graphology';

export async function detectCommunities(graph: Graph): Promise<Record<number, string[]>> {
  try {
    const { default: louvain } = await import('graphology-communities-louvain');
    const assignment = louvain(graph) as Record<string, number>;

    for (const [nodeId, communityId] of Object.entries(assignment)) {
      graph.setNodeAttribute(nodeId, 'community', communityId);
    }

    const communities: Record<number, string[]> = {};
    for (const [nodeId, communityId] of Object.entries(assignment)) {
      if (!communities[communityId]) communities[communityId] = [];
      communities[communityId].push(nodeId);
    }
    return splitOversizedCommunities(graph, communities);
  } catch {
    return splitOversizedCommunities(graph, fallbackCluster(graph));
  }
}

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

export function cohesionScore(graph: Graph, communityNodes: string[]): number {
  const memberSet = new Set(communityNodes);
  let totalEdges = 0;
  let internalEdges = 0;

  graph.forEachEdge((_edge, _attrs, source, target) => {
    const srcIn = memberSet.has(source);
    const tgtIn = memberSet.has(target);
    if (srcIn || tgtIn) {
      totalEdges++;
      if (srcIn && tgtIn) internalEdges++;
    }
  });

  return totalEdges === 0 ? 1.0 : internalEdges / totalEdges;
}

export function splitOversizedCommunities(
  graph: Graph,
  communities: Record<number, string[]>,
  threshold = 0.25,
): Record<number, string[]> {
  const maxSize = threshold * graph.order;
  const allIds = Object.keys(communities).map(Number);
  let nextId = allIds.length > 0 ? Math.max(...allIds) + 1 : 0;

  for (const [cidStr, members] of Object.entries(communities)) {
    if (members.length <= maxSize) continue;

    const cid = Number(cidStr);
    const subMap = new Map<string, number>();
    const newSubIds: Record<number, string[]> = {};

    for (const nodeId of members) {
      const file = (graph.getNodeAttribute(nodeId, 'sourceFile') as string) || '';
      const parts = file.split('/');
      const parentDir = parts.length > 1 ? parts[parts.length - 2] : 'root';

      if (!subMap.has(parentDir)) subMap.set(parentDir, nextId++);
      const subId = subMap.get(parentDir)!;
      graph.setNodeAttribute(nodeId, 'community', subId);
      if (!newSubIds[subId]) newSubIds[subId] = [];
      newSubIds[subId].push(nodeId);
    }

    delete communities[cid];
    Object.assign(communities, newSubIds);
  }

  return communities;
}
