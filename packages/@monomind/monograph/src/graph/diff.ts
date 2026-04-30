import type { MonographNode, MonographEdge } from '../types.js';

export interface GraphSnapshot {
  nodes: MonographNode[];
  edges: MonographEdge[];
  capturedAt: string;
}

export interface GraphDiff {
  newNodes: MonographNode[];
  removedNodes: MonographNode[];
  newEdges: MonographEdge[];
  removedEdges: MonographEdge[];
  modifiedNodes: Array<{ before: MonographNode; after: MonographNode }>;
}

export function diffSnapshots(before: GraphSnapshot, after: GraphSnapshot): GraphDiff {
  const beforeNodeIds = new Map(before.nodes.map(n => [n.id, n]));
  const afterNodeIds = new Map(after.nodes.map(n => [n.id, n]));
  const beforeEdgeIds = new Set(before.edges.map(e => e.id));
  const afterEdgeIds = new Set(after.edges.map(e => e.id));

  return {
    newNodes: after.nodes.filter(n => !beforeNodeIds.has(n.id)),
    removedNodes: before.nodes.filter(n => !afterNodeIds.has(n.id)),
    newEdges: after.edges.filter(e => !beforeEdgeIds.has(e.id)),
    removedEdges: before.edges.filter(e => !afterEdgeIds.has(e.id)),
    modifiedNodes: after.nodes
      .filter(n => beforeNodeIds.has(n.id))
      .filter(n => JSON.stringify(n) !== JSON.stringify(beforeNodeIds.get(n.id)))
      .map(n => ({ before: beforeNodeIds.get(n.id)!, after: n })),
  };
}

export function snapshotFromDb(db: import('../storage/db.js').MonographDb): GraphSnapshot {
  const nodes = db.prepare('SELECT * FROM nodes').all() as Record<string, unknown>[];
  const edges = db.prepare('SELECT * FROM edges').all() as Record<string, unknown>[];
  return {
    nodes: nodes as unknown as MonographNode[],
    edges: edges as unknown as MonographEdge[],
    capturedAt: new Date().toISOString(),
  };
}
