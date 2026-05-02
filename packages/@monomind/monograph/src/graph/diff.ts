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
  /** Human-readable summary, e.g. "3 new nodes, 5 new edges, 1 node removed". */
  summary: string;
}

function buildDiffSummary(
  newNodes: MonographNode[],
  removedNodes: MonographNode[],
  newEdges: MonographEdge[],
  removedEdges: MonographEdge[],
  modifiedNodes: Array<{ before: MonographNode; after: MonographNode }>,
): string {
  const parts: string[] = [];
  if (newNodes.length > 0) parts.push(`${newNodes.length} new node${newNodes.length !== 1 ? 's' : ''}`);
  if (newEdges.length > 0) parts.push(`${newEdges.length} new edge${newEdges.length !== 1 ? 's' : ''}`);
  if (removedNodes.length > 0) parts.push(`${removedNodes.length} node${removedNodes.length !== 1 ? 's' : ''} removed`);
  if (removedEdges.length > 0) parts.push(`${removedEdges.length} edge${removedEdges.length !== 1 ? 's' : ''} removed`);
  if (modifiedNodes.length > 0) parts.push(`${modifiedNodes.length} node${modifiedNodes.length !== 1 ? 's' : ''} modified`);
  return parts.length > 0 ? parts.join(', ') : 'no changes';
}

export function diffSnapshots(before: GraphSnapshot, after: GraphSnapshot): GraphDiff {
  const beforeNodeIds = new Map(before.nodes.map(n => [n.id, n]));
  const afterNodeIds = new Map(after.nodes.map(n => [n.id, n]));
  const beforeEdgeIds = new Set(before.edges.map(e => e.id));
  const afterEdgeIds = new Set(after.edges.map(e => e.id));

  const newNodes = after.nodes.filter(n => !beforeNodeIds.has(n.id));
  const removedNodes = before.nodes.filter(n => !afterNodeIds.has(n.id));
  const newEdges = after.edges.filter(e => !beforeEdgeIds.has(e.id));
  const removedEdges = before.edges.filter(e => !afterEdgeIds.has(e.id));
  const modifiedNodes = after.nodes
    .filter(n => beforeNodeIds.has(n.id))
    .filter(n => JSON.stringify(n) !== JSON.stringify(beforeNodeIds.get(n.id)))
    .map(n => ({ before: beforeNodeIds.get(n.id)!, after: n }));

  return {
    newNodes,
    removedNodes,
    newEdges,
    removedEdges,
    modifiedNodes,
    summary: buildDiffSummary(newNodes, removedNodes, newEdges, removedEdges, modifiedNodes),
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
