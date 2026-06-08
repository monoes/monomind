import type { MonographNode, MonographEdge } from '../types.js';
import type { MonographDb } from '../storage/db.js';

export interface InducedSubgraph {
  nodes: MonographNode[];
  edges: MonographEdge[];
}

/**
 * Extract the induced subgraph for the given set of node ids.
 *
 * The induced subgraph contains:
 * - Only the nodes whose ids are in `nodeIds` (and exist in the DB)
 * - Only the edges where both source and target are in `nodeIds`
 *
 * @param db - The MonographDb instance
 * @param nodeIds - The subset of node ids to include
 * @returns An object with `nodes` and `edges` arrays
 */
// SQLite SQLITE_MAX_VARIABLE_NUMBER limit (32766). Edge query binds nodeIds once
// (source_id IN chunk), then filters target in-memory — full limit available per chunk.
const SQLITE_VAR_LIMIT = 32766;

export function extractInducedSubgraph(db: MonographDb, nodeIds: string[]): InducedSubgraph {
  if (nodeIds.length === 0) return { nodes: [], edges: [] };

  // Chunk helper to stay within SQLITE_MAX_VARIABLE_NUMBER
  function queryChunked<T>(ids: string[], chunkSize: number, query: (ph: string, chunk: string[]) => T[]): T[] {
    const results: T[] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const ph = chunk.map(() => '?').join(',');
      results.push(...query(ph, chunk));
    }
    return results;
  }

  type RawNode = {
    id: string; label: string; name: string; norm_label?: string | null; file_path: string | null;
    start_line: number | null; end_line: number | null; community_id: number | null;
    is_exported: number; language: string | null; properties: string | null;
  };
  type RawEdge = {
    id: string; source_id: string; target_id: string; relation: string;
    confidence: string; confidence_score: number; reason: string | null; evidence: string | null;
  };

  const rawNodes = queryChunked<RawNode>(nodeIds, SQLITE_VAR_LIMIT, (ph, chunk) =>
    db.prepare(
      `SELECT id, label, name, file_path, start_line, end_line, community_id, is_exported, language, properties
       FROM nodes WHERE id IN (${ph})`
    ).all(...chunk) as RawNode[]
  );

  // For edges: query by source_id chunks (1 bind per row), then filter target in-memory.
  // Querying by both source+target would miss cross-chunk edges and requires 2× bind slots.
  const nodeSet = new Set(nodeIds);
  const rawEdges = queryChunked<RawEdge>(nodeIds, SQLITE_VAR_LIMIT, (ph, chunk) =>
    (db.prepare(
      `SELECT id, source_id, target_id, relation, confidence, confidence_score, reason, evidence
       FROM edges WHERE source_id IN (${ph})`
    ).all(...chunk) as RawEdge[]).filter(e => nodeSet.has(e.target_id))
  );

  const nodes: MonographNode[] = rawNodes.map(n => ({
    id: n.id,
    label: n.label as MonographNode['label'],
    name: n.name,
    normLabel: (n.norm_label ?? n.name ?? '').toLowerCase(),
    filePath: n.file_path ?? undefined,
    startLine: n.start_line ?? undefined,
    endLine: n.end_line ?? undefined,
    communityId: n.community_id ?? undefined,
    isExported: n.is_exported === 1,
    language: n.language ?? undefined,
    properties: n.properties ? (JSON.parse(n.properties) as Record<string, unknown>) : undefined,
  }));

  const edges: MonographEdge[] = rawEdges.map(e => ({
    id: e.id,
    sourceId: e.source_id,
    targetId: e.target_id,
    relation: e.relation as MonographEdge['relation'],
    confidence: e.confidence as MonographEdge['confidence'],
    confidenceScore: e.confidence_score,
    reason: e.reason ?? undefined,
  }));

  return { nodes, edges };
}
