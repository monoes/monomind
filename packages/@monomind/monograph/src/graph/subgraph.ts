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
export function extractInducedSubgraph(db: MonographDb, nodeIds: string[]): InducedSubgraph {
  if (nodeIds.length === 0) return { nodes: [], edges: [] };

  const placeholders = nodeIds.map(() => '?').join(',');

  const rawNodes = db.prepare(
    `SELECT id, label, name, file_path, start_line, end_line, community_id, is_exported, language, properties
     FROM nodes WHERE id IN (${placeholders})`
  ).all(...nodeIds) as {
    id: string;
    label: string;
    name: string;
    file_path: string | null;
    start_line: number | null;
    end_line: number | null;
    community_id: number | null;
    is_exported: number;
    language: string | null;
    properties: string | null;
  }[];

  const rawEdges = db.prepare(
    `SELECT id, source_id, target_id, relation, confidence, confidence_score, reason, evidence
     FROM edges WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})`
  ).all(...nodeIds, ...nodeIds) as {
    id: string;
    source_id: string;
    target_id: string;
    relation: string;
    confidence: string;
    confidence_score: number;
    reason: string | null;
    evidence: string | null;
  }[];

  const nodes: MonographNode[] = rawNodes.map(n => ({
    id: n.id,
    label: n.label as MonographNode['label'],
    name: n.name,
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
    relation: e.relation,
    confidence: e.confidence as MonographEdge['confidence'],
    confidenceScore: e.confidence_score,
    reason: e.reason ?? undefined,
  }));

  return { nodes, edges };
}
