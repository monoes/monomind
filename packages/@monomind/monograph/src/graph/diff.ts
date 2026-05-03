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
  const rawNodes = db.prepare(`
    SELECT id, label, name,
      norm_label AS normLabel,
      file_path AS filePath,
      start_line AS startLine,
      end_line AS endLine,
      community_id AS communityId,
      is_exported AS isExported,
      language, properties
    FROM nodes
  `).all() as Array<Record<string, unknown>>;

  const rawEdges = db.prepare(`
    SELECT id,
      source_id AS sourceId,
      target_id AS targetId,
      relation, confidence,
      confidence_score AS confidenceScore
    FROM edges
  `).all() as Array<Record<string, unknown>>;

  const nodes: MonographNode[] = rawNodes.map(r => ({
    ...r,
    isExported: Boolean(r['isExported']),
  } as MonographNode));

  const edges = rawEdges as unknown as MonographEdge[];

  return { nodes, edges, capturedAt: new Date().toISOString() };
}
