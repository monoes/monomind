import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';

// ── Row → MonographNode mapper ─────────────────────────────────────────────────

function rowToNode(row: Record<string, unknown>): MonographNode {
  return {
    id: row.id as string,
    label: row.label as MonographNode['label'],
    name: row.name as string,
    normLabel: row.norm_label as string,
    filePath: row.file_path as string | undefined,
    startLine: row.start_line as number | undefined,
    endLine: row.end_line as number | undefined,
    communityId: row.community_id as number | undefined,
    isExported: (row.is_exported as number) === 1,
    language: row.language as string | undefined,
    properties: row.properties ? JSON.parse(row.properties as string) : undefined,
  };
}

// ── Output type ────────────────────────────────────────────────────────────────

export interface MonographContextResult {
  node: MonographNode | null;
  callers: MonographNode[];
  callees: MonographNode[];
  imports: MonographNode[];
  importedBy: MonographNode[];
  community: { id: number; label?: string } | null;
  inProcesses: Array<{ id: string; name: string }>;
}

// ── Shared helper: query related nodes by edge relation and direction ──────────

function queryRelated(
  db: Database.Database,
  nodeId: string,
  relation: string,
  inbound: boolean,
  limit = 50,
): MonographNode[] {
  // inbound=true  → this node is the target; source nodes are the result
  // inbound=false → this node is the source; target nodes are the result
  const [filterCol, joinCol] = inbound
    ? ['target_id', 'source_id']
    : ['source_id', 'target_id'];

  const rows = db
    .prepare(
      `SELECT n.* FROM nodes n JOIN edges e ON n.id = e.${joinCol}
       WHERE e.${filterCol} = ? AND e.relation = ? LIMIT ?`,
    )
    .all(nodeId, relation, limit) as Record<string, unknown>[];

  return rows.map(rowToNode);
}

// ── Implementation ─────────────────────────────────────────────────────────────

export function getMonographContext(
  db: Database.Database,
  input: { name: string; filePath?: string },
): MonographContextResult {
  const LIMIT = 50;

  // 1. Find the node
  let nodeRow: Record<string, unknown> | undefined;
  if (input.filePath) {
    nodeRow = db
      .prepare('SELECT * FROM nodes WHERE name = ? AND file_path = ? LIMIT 1')
      .get(input.name, input.filePath) as Record<string, unknown> | undefined;
  } else {
    nodeRow = db
      .prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1')
      .get(input.name) as Record<string, unknown> | undefined;
  }

  if (!nodeRow) {
    return { node: null, callers: [], callees: [], imports: [], importedBy: [], community: null, inProcesses: [] };
  }

  const node = rowToNode(nodeRow);
  const nodeId = node.id;

  // 2–5. Callers / callees / imports / importedBy via shared helper
  const callers    = queryRelated(db, nodeId, 'CALLS',   true,  LIMIT);
  const callees    = queryRelated(db, nodeId, 'CALLS',   false, LIMIT);
  const imports    = queryRelated(db, nodeId, 'IMPORTS', false, LIMIT);
  const importedBy = queryRelated(db, nodeId, 'IMPORTS', true,  LIMIT);

  // 6. Community: from node's community_id field
  let community: { id: number; label?: string } | null = null;
  if (node.communityId != null) {
    const commRow = db
      .prepare('SELECT id, label FROM communities WHERE id = ?')
      .get(node.communityId) as { id: number; label?: string } | undefined;
    community = commRow ?? { id: node.communityId };
  }

  // 7. inProcesses: processes that contain this node as a step
  // STEP_IN_PROCESS edge goes: process → step_symbol
  const processRows = db
    .prepare(
      `SELECT n.id, n.name FROM nodes n JOIN edges e ON n.id = e.source_id
       WHERE e.target_id = ? AND e.relation = 'STEP_IN_PROCESS' LIMIT ?`,
    )
    .all(nodeId, LIMIT) as Array<{ id: string; name: string }>;

  return { node, callers, callees, imports, importedBy, community, inProcesses: processRows };
}
