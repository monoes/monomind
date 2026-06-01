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

  // 2. Callers: nodes that CALL this node (inbound CALLS edges)
  const callerRows = db
    .prepare(
      `SELECT n.* FROM nodes n JOIN edges e ON n.id = e.source_id
       WHERE e.target_id = ? AND e.relation = 'CALLS' LIMIT ?`,
    )
    .all(nodeId, LIMIT) as Record<string, unknown>[];

  // 3. Callees: nodes this node CALLS (outbound CALLS edges)
  const calleeRows = db
    .prepare(
      `SELECT n.* FROM nodes n JOIN edges e ON n.id = e.target_id
       WHERE e.source_id = ? AND e.relation = 'CALLS' LIMIT ?`,
    )
    .all(nodeId, LIMIT) as Record<string, unknown>[];

  // 4. Imports: what this node imports (outbound IMPORTS edges)
  const importRows = db
    .prepare(
      `SELECT n.* FROM nodes n JOIN edges e ON n.id = e.target_id
       WHERE e.source_id = ? AND e.relation = 'IMPORTS' LIMIT ?`,
    )
    .all(nodeId, LIMIT) as Record<string, unknown>[];

  // 5. ImportedBy: what imports this node (inbound IMPORTS edges)
  const importedByRows = db
    .prepare(
      `SELECT n.* FROM nodes n JOIN edges e ON n.id = e.source_id
       WHERE e.target_id = ? AND e.relation = 'IMPORTS' LIMIT ?`,
    )
    .all(nodeId, LIMIT) as Record<string, unknown>[];

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

  return {
    node,
    callers: callerRows.map(rowToNode),
    callees: calleeRows.map(rowToNode),
    imports: importRows.map(rowToNode),
    importedBy: importedByRows.map(rowToNode),
    community,
    inProcesses: processRows,
  };
}
