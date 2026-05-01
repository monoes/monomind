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

export function getMonographNeighbors(
  db: Database.Database,
  input: { name: string; relationFilter?: string; includeInbound?: boolean },
): MonographNeighborsResult {
  const nodeRow = db
    .prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1')
    .get(input.name) as Record<string, unknown> | undefined;

  if (!nodeRow) return { node: null, neighbors: [] };

  const node = rowToNode(nodeRow);
  const neighbors: NeighborEntry[] = [];

  // Outbound edges
  const outboundSql = input.relationFilter
    ? `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.target_id WHERE e.source_id = ? AND e.relation = ? LIMIT 50`
    : `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.target_id WHERE e.source_id = ? LIMIT 50`;

  const outboundParams = input.relationFilter ? [node.id, input.relationFilter] : [node.id];
  const outboundRows = db.prepare(outboundSql).all(...outboundParams) as Record<string, unknown>[];

  for (const row of outboundRows) {
    neighbors.push({
      node: rowToNode(row),
      relation: row['relation'] as string,
      confidence: row['confidence'] as string,
      confidenceScore: (row['confidence_score'] as number) ?? 1,
      direction: 'outbound',
    });
  }

  // Inbound edges
  if (input.includeInbound) {
    const inboundSql = input.relationFilter
      ? `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.source_id WHERE e.target_id = ? AND e.relation = ? LIMIT 50`
      : `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.source_id WHERE e.target_id = ? LIMIT 50`;

    const inboundParams = input.relationFilter ? [node.id, input.relationFilter] : [node.id];
    const inboundRows = db.prepare(inboundSql).all(...inboundParams) as Record<string, unknown>[];

    for (const row of inboundRows) {
      neighbors.push({
        node: rowToNode(row),
        relation: row['relation'] as string,
        confidence: row['confidence'] as string,
        confidenceScore: (row['confidence_score'] as number) ?? 1,
        direction: 'inbound',
      });
    }
  }

  return { node, neighbors };
}
