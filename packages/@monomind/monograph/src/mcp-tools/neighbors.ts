import type Database from 'better-sqlite3';
import { rowToNode } from '../storage/node-store.js';
import type { MonographNode } from '../types.js';

export interface NeighborEntry {
  node: MonographNode;
  relation: string;
  confidence: string;
  confidenceScore: number;
  direction: 'outbound' | 'inbound';
}

/** A node a name could have referred to — enough to re-query unambiguously. */
export interface NeighborCandidate {
  id: string;
  name: string;
  label: string;
  filePath: string | null;
  startLine: number | null;
}

export interface MonographNeighborsResult {
  node: MonographNode | null;
  neighbors: NeighborEntry[];
  /** True when `name` matched several nodes and nothing narrowed it to one. */
  ambiguous: boolean;
  /** Populated when ambiguous — re-query with `nodeId` or `filePath`. */
  candidates: NeighborCandidate[];
  /** Neighbors matching the query before `limit` was applied. */
  totalNeighbors: number;
  /** True when `totalNeighbors` exceeds the returned `neighbors`. */
  truncated: boolean;
  /** The cap that was applied per direction. */
  limit: number;
}

export interface MonographNeighborsInput {
  /** Canonical node id — the unambiguous way to address a node. */
  nodeId?: string;
  /** Symbol name; may match several nodes. */
  name?: string;
  /** Narrows an ambiguous `name` — exact file path or a trailing fragment of one. */
  filePath?: string;
  relationFilter?: string;
  includeInbound?: boolean;
  /** Max neighbors per direction (default 50, hard cap 500). */
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
/** Candidate lists exist to be read by a human or an agent; a long one is noise. */
const CANDIDATE_CAP = 25;

// ── Shared edge query helper ──────────────────────────────────────────────────

function edgeColumns(direction: 'outbound' | 'inbound'): [string, string] {
  // outbound: source_id = nodeId → join target_id
  // inbound:  target_id = nodeId → join source_id
  return direction === 'outbound' ? ['source_id', 'target_id'] : ['target_id', 'source_id'];
}

function countEdges(
  db: Database.Database,
  nodeId: string,
  direction: 'outbound' | 'inbound',
  relationFilter?: string,
): number {
  const [idCol] = edgeColumns(direction);
  const sql = relationFilter
    ? `SELECT COUNT(*) AS c FROM edges e WHERE e.${idCol} = ? AND e.relation = ?`
    : `SELECT COUNT(*) AS c FROM edges e WHERE e.${idCol} = ?`;
  const params = relationFilter ? [nodeId, relationFilter] : [nodeId];
  return (db.prepare(sql).get(...params) as { c: number }).c;
}

function queryEdges(
  db: Database.Database,
  nodeId: string,
  direction: 'outbound' | 'inbound',
  relationFilter: string | undefined,
  limit: number,
): NeighborEntry[] {
  const [idCol, joinCol] = edgeColumns(direction);

  const sql = relationFilter
    ? `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.${joinCol} WHERE e.${idCol} = ? AND e.relation = ? LIMIT ?`
    : `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.${joinCol} WHERE e.${idCol} = ? LIMIT ?`;

  const params = relationFilter ? [nodeId, relationFilter, limit] : [nodeId, limit];
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

  return rows.map((row) => ({
    node: rowToNode(row),
    relation: row.relation as string,
    confidence: row.confidence as string,
    confidenceScore: (row.confidence_score as number) ?? 1,
    direction,
  }));
}

// ── Node resolution ───────────────────────────────────────────────────────────

function toCandidate(row: Record<string, unknown>): NeighborCandidate {
  return {
    id: row.id as string,
    name: row.name as string,
    label: row.label as string,
    filePath: (row.file_path as string | null) ?? null,
    startLine: (row.start_line as number | null) ?? null,
  };
}

/** Exact path match, else a trailing-fragment match so `user.ts` narrows `/app/user.ts`. */
function matchesFilePath(row: Record<string, unknown>, filePath: string): boolean {
  const rowPath = (row.file_path as string | null) ?? '';
  return rowPath === filePath || rowPath.endsWith(filePath);
}

function emptyResult(
  limit: number,
  candidates: NeighborCandidate[] = [],
): MonographNeighborsResult {
  return {
    node: null,
    neighbors: [],
    ambiguous: candidates.length > 1,
    candidates,
    totalNeighbors: 0,
    truncated: false,
    limit,
  };
}

export function getMonographNeighbors(
  db: Database.Database,
  input: MonographNeighborsInput,
): MonographNeighborsResult {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  let nodeRow: Record<string, unknown> | undefined;

  if (input.nodeId) {
    nodeRow = db.prepare('SELECT * FROM nodes WHERE id = ?').get(input.nodeId) as
      | Record<string, unknown>
      | undefined;
    if (!nodeRow) return emptyResult(limit);
  } else if (input.name) {
    const rows = db
      .prepare('SELECT * FROM nodes WHERE name = ? LIMIT ?')
      .all(input.name, CANDIDATE_CAP + 1) as Record<string, unknown>[];
    const matches = input.filePath
      ? rows.filter((r) => matchesFilePath(r, input.filePath as string))
      : rows;

    if (matches.length === 0) return emptyResult(limit);
    if (matches.length > 1) {
      // A confident answer about the wrong node is worse than asking which one.
      return emptyResult(limit, matches.slice(0, CANDIDATE_CAP).map(toCandidate));
    }
    nodeRow = matches[0];
  } else {
    return emptyResult(limit);
  }

  const node = rowToNode(nodeRow);
  const neighbors: NeighborEntry[] = [
    ...queryEdges(db, node.id, 'outbound', input.relationFilter, limit),
    ...(input.includeInbound
      ? queryEdges(db, node.id, 'inbound', input.relationFilter, limit)
      : []),
  ];

  const totalNeighbors =
    countEdges(db, node.id, 'outbound', input.relationFilter) +
    (input.includeInbound ? countEdges(db, node.id, 'inbound', input.relationFilter) : 0);

  return {
    node,
    neighbors,
    ambiguous: false,
    candidates: [],
    totalNeighbors,
    truncated: totalNeighbors > neighbors.length,
    limit,
  };
}
