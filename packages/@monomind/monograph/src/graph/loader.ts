import Graph from 'graphology';
import type { MonographEdge } from '../types.js';

export function loadGraphFromEdges(edges: MonographEdge[]): Graph {
  const graph = new Graph({ multi: true, type: 'directed' });
  for (const edge of edges) {
    if (!graph.hasNode(edge.sourceId)) graph.addNode(edge.sourceId);
    if (!graph.hasNode(edge.targetId)) graph.addNode(edge.targetId);
    try {
      graph.addEdge(edge.sourceId, edge.targetId, {
        id: edge.id, relation: edge.relation,
        confidence: edge.confidence, confidenceScore: edge.confidenceScore,
      });
    } catch { /* duplicate edge */ }
  }
  return graph;
}

export function loadGraphFromDb(db: import('../storage/db.js').MonographDb): Graph {
  const nodes = db.prepare('SELECT id FROM nodes').all() as { id: string }[];
  // Explicitly select only the columns used here — avoids fetching reason/evidence blobs
  const edges = db.prepare(
    'SELECT id, source_id, target_id, relation, confidence, confidence_score FROM edges'
  ).all() as {
    id: string; source_id: string; target_id: string; relation: string;
    confidence: string; confidence_score: number;
  }[];

  const graph = new Graph({ multi: true, type: 'directed' });
  // Seed known nodes first; edges below may reference node ids not in the nodes table
  // (defensive: addNode is a no-op guard here, has-check avoided to reduce overhead)
  for (const n of nodes) graph.mergeNode(n.id);
  for (const e of edges) {
    graph.mergeNode(e.source_id);
    graph.mergeNode(e.target_id);
    try {
      graph.addEdge(e.source_id, e.target_id, {
        id: e.id, relation: e.relation,
        confidence: e.confidence, confidenceScore: e.confidence_score,
      });
    } catch { /* skip duplicate edges */ }
  }
  return graph;
}
