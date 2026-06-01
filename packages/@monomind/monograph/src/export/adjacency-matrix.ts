import type { MonographNode, MonographEdge } from '../types.js';
import type { MonographDb } from '../storage/db.js';

// ── Output types ───────────────────────────────────────────────────────────────

export interface AdjacencyMatrix {
  /** Ordered node ids (row/column headers). */
  nodeIds: string[];
  /** Ordered node names, parallel to nodeIds. */
  nodeNames: string[];
  /** n×n matrix where matrix[i][j] = number of edges from nodeIds[i] to nodeIds[j]. */
  matrix: number[][];
}

// ── Builder ────────────────────────────────────────────────────────────────────

/**
 * Build an adjacency matrix from a set of nodes and edges.
 *
 * Multi-edges (same source→target pair) are counted, so the matrix
 * contains edge-counts rather than simple 0/1 booleans.
 *
 * @param nodes - The node list (defines row/column order).
 * @param edges - The edge list.
 * @returns An AdjacencyMatrix with nodeIds, nodeNames, and the n×n matrix.
 */
export function buildAdjacencyMatrix(
  nodes: MonographNode[],
  edges: MonographEdge[],
): AdjacencyMatrix {
  const nodeIds = nodes.map(n => n.id);
  const nodeNames = nodes.map(n => n.name);
  const indexMap = new Map<string, number>(nodeIds.map((id, i) => [id, i]));
  const n = nodeIds.length;

  if (n > 5000) {
    throw new Error(
      `adjacency matrix would be ${n}×${n} (${n * n} cells). ` +
      'Pass a pre-filtered node list via the nodeIds parameter, or use a different export format.'
    );
  }

  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (const edge of edges) {
    const si = indexMap.get(edge.sourceId);
    const ti = indexMap.get(edge.targetId);
    if (si !== undefined && ti !== undefined) {
      matrix[si][ti]++;
    }
  }

  return { nodeIds, nodeNames, matrix };
}

// ── DB-backed variant ──────────────────────────────────────────────────────────

/**
 * Build an adjacency matrix directly from a MonographDb.
 * Optionally restrict to a subset of node ids.
 */
export function buildAdjacencyMatrixFromDb(
  db: MonographDb,
  nodeIds?: string[],
): AdjacencyMatrix {
  let nodeRows: { id: string; name: string }[];

  if (nodeIds && nodeIds.length > 0) {
    const ph = nodeIds.map(() => '?').join(',');
    nodeRows = db
      .prepare(`SELECT id, name FROM nodes WHERE id IN (${ph})`)
      .all(...nodeIds) as { id: string; name: string }[];
  } else {
    nodeRows = db.prepare('SELECT id, name FROM nodes').all() as { id: string; name: string }[];
  }

  const nodes: MonographNode[] = nodeRows.map(r => ({
    id: r.id,
    label: 'Function' as MonographNode['label'], // placeholder; only id/name needed here
    name: r.name,
    normLabel: r.name.toLowerCase(),
    isExported: false,
  }));

  const nodeIdSet = new Set(nodeRows.map(r => r.id));

  let edgeRows: { source_id: string; target_id: string }[];
  if (nodeIds && nodeIds.length > 0) {
    const ph = nodeIds.map(() => '?').join(',');
    edgeRows = db
      .prepare(`SELECT source_id, target_id FROM edges WHERE source_id IN (${ph}) AND target_id IN (${ph})`)
      .all(...nodeIds, ...nodeIds) as { source_id: string; target_id: string }[];
  } else {
    edgeRows = db.prepare('SELECT source_id, target_id FROM edges').all() as {
      source_id: string;
      target_id: string;
    }[];
  }

  const edges: MonographEdge[] = edgeRows
    .filter(r => nodeIdSet.has(r.source_id) && nodeIdSet.has(r.target_id))
    .map((r, i) => ({
      id: `e${i}`,
      sourceId: r.source_id,
      targetId: r.target_id,
      relation: 'REFERENCES' as MonographEdge['relation'],
      confidence: 'EXTRACTED' as MonographEdge['confidence'],
      confidenceScore: 1,
    }));

  return buildAdjacencyMatrix(nodes, edges);
}

// ── CSV serialiser ─────────────────────────────────────────────────────────────

/**
 * Serialise an AdjacencyMatrix to a CSV string.
 * The first row and first column are node names (headers).
 */
export function adjacencyMatrixToCsv(am: AdjacencyMatrix): string {
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = ['', ...am.nodeNames.map(escape)].join(',');
  const rows = am.matrix.map((row, i) =>
    [escape(am.nodeNames[i]), ...row.map(String)].join(','),
  );
  return [header, ...rows].join('\n');
}
