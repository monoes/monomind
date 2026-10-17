import type Database from 'better-sqlite3';
import { rowToNode } from '../storage/node-store.js';
import type { MonographNode } from '../types.js';
import { resolveNodeByName, type SymbolCandidate } from './resolve-node.js';

// ── Output type ────────────────────────────────────────────────────────────────

export interface MonographContextResult {
  node: MonographNode | null;
  callers: MonographNode[];
  callees: MonographNode[];
  imports: MonographNode[];
  importedBy: MonographNode[];
  /** Test files that call this symbol directly (TESTS edges to the node). */
  testedBy: MonographNode[];
  /** Test files that import this symbol's file — coarser than `testedBy`. */
  fileTests: MonographNode[];
  community: { id: number; label?: string } | null;
  inProcesses: Array<{ id: string; name: string }>;
  /** True when `name` matched several nodes and nothing narrowed it to one. */
  ambiguous?: boolean;
  /** Populated when ambiguous (non-test first) — re-query with `nodeId` or `filePath`. */
  candidates?: SymbolCandidate[];
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
  const [filterCol, joinCol] = inbound ? ['target_id', 'source_id'] : ['source_id', 'target_id'];

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
  input: { name: string; filePath?: string; nodeId?: string },
): MonographContextResult {
  const LIMIT = 50;

  // 1. Find the node — several same-named definitions are returned as
  // candidates rather than silently narrowed to one.
  const { row: nodeRow, candidates } = input.nodeId
    ? {
        row: db.prepare('SELECT * FROM nodes WHERE id = ?').get(input.nodeId) as
          | Record<string, unknown>
          | undefined,
        candidates: [],
      }
    : resolveNodeByName(db, input.name, input.filePath);

  if (!nodeRow) {
    return {
      node: null,
      callers: [],
      callees: [],
      imports: [],
      importedBy: [],
      testedBy: [],
      fileTests: [],
      community: null,
      inProcesses: [],
      ambiguous: candidates.length > 1,
      candidates,
    };
  }

  const node = rowToNode(nodeRow);
  const nodeId = node.id;

  // 2–5. Callers / callees / imports / importedBy via shared helper
  const callers = queryRelated(db, nodeId, 'CALLS', true, LIMIT);
  const callees = queryRelated(db, nodeId, 'CALLS', false, LIMIT);
  const imports = queryRelated(db, nodeId, 'IMPORTS', false, LIMIT);
  const importedBy = queryRelated(db, nodeId, 'IMPORTS', true, LIMIT);

  // Tests: files with a TESTS edge to this symbol, and to the file defining it.
  const testedBy = queryRelated(db, nodeId, 'TESTS', true, LIMIT);
  const fileRow = node.filePath
    ? (db
        .prepare("SELECT id FROM nodes WHERE label = 'File' AND file_path = ? AND id != ?")
        .get(node.filePath, nodeId) as { id: string } | undefined)
    : undefined;
  const seen = new Set(testedBy.map((t) => t.id));
  const fileTests = fileRow
    ? queryRelated(db, fileRow.id, 'TESTS', true, LIMIT).filter((t) => !seen.has(t.id))
    : [];

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
    callers,
    callees,
    imports,
    importedBy,
    testedBy,
    fileTests,
    community,
    inProcesses: processRows,
    ambiguous: false,
    candidates: [],
  };
}
