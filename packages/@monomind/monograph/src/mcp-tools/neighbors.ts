import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';

function rowToNode(row: Record<string, unknown>): MonographNode {
  return {
    id: row['id'] as string,
    label: row['label'] as MonographNode['label'],
    name: row['name'] as string,
    normLabel: (row['norm_label'] as string) ?? '',
    filePath: row['file_path'] as string | undefined,
    startLine: row['start_line'] as number | undefined,
    endLine: row['end_line'] as number | undefined,
    communityId: row['community_id'] as number | undefined,
    isExported: (row['is_exported'] as number) === 1,
    language: row['language'] as string | undefined,
    properties: row['properties'] ? JSON.parse(row['properties'] as string) : undefined,
  };
}

export interface NeighborEntry {
  node: MonographNode;
  relation: string;
  confidence: string;
  confidenceScore: number;
  direction: 'outbound' | 'inbound';
}

export interface MonographNeighborsResult {
  node: MonographNode | null;
  neighbors: NeighborEntry[];
}

// ── Shared edge query helper ──────────────────────────────────────────────────

function queryEdges(
  db: Database.Database,
  nodeId: string,
  direction: 'outbound' | 'inbound',
  relationFilter?: string,
): NeighborEntry[] {
  // outbound: source_id = nodeId → join target_id
  // inbound:  target_id = nodeId → join source_id
  const [idCol, joinCol] = direction === 'outbound'
    ? ['source_id', 'target_id']
    : ['target_id', 'source_id'];

  const sql = relationFilter
    ? `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.${joinCol} WHERE e.${idCol} = ? AND e.relation = ? LIMIT 50`
    : `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.${joinCol} WHERE e.${idCol} = ? LIMIT 50`;

  const params = relationFilter ? [nodeId, relationFilter] : [nodeId];
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

  return rows.map(row => ({
    node: rowToNode(row),
    relation: row['relation'] as string,
    confidence: row['confidence'] as string,
    confidenceScore: (row['confidence_score'] as number) ?? 1,
    direction,
  }));
}

export function getMonographNeighbors(
  db: Database.Database,
  input: { name: string; relationFilter?: string; includeInbound?: boolean },
): MonographNeighborsResult {
  const nodeRow = db
    .prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1')
    .get(input.name) as Record<string, unknown> | undefined;

  if (!nodeRow) return { node: null, neighbors: [] };

  const node = rowToNode(nodeRow);
  const neighbors: NeighborEntry[] = [
    ...queryEdges(db, node.id, 'outbound', input.relationFilter),
    ...(input.includeInbound ? queryEdges(db, node.id, 'inbound', input.relationFilter) : []),
  ];

  return { node, neighbors };
}
