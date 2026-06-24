import Database from 'better-sqlite3';
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

/** Cache of placeholder strings keyed by count: 1 → "?", 2 → "?,?", etc. */
const placeholderCache = new Map<number, string>();
function placeholders(n: number): string {
  let ph = placeholderCache.get(n);
  if (!ph) {
    ph = Array(n).fill('?').join(',');
    placeholderCache.set(n, ph);
  }
  return ph;
}

type RawNode = {
  id: string; label: string; name: string; norm_label?: string | null; file_path: string | null;
  start_line: number | null; end_line: number | null; community_id: number | null;
  is_exported: number; language: string | null; properties: string | null;
};
type RawEdge = {
  id: string; source_id: string; target_id: string; relation: string;
  confidence: string; confidence_score: number; reason: string | null;
  // evidence column omitted — not surfaced in InducedSubgraph
};

/**
 * Prepared-statement caches per db instance — stored on the db object to avoid
 * cross-db pollution while ensuring each unique chunk size is prepared at most once.
 */
function getStmtCaches(db: MonographDb): {
  nodes: Map<number, ReturnType<MonographDb['prepare']>>;
  edges: Map<number, ReturnType<MonographDb['prepare']>>;
} {
  const key = '__subgraphStmtCache__';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any;
  if (!dbAny[key]) {
    dbAny[key] = { nodes: new Map(), edges: new Map() };
  }
  return dbAny[key] as { nodes: Map<number, ReturnType<MonographDb['prepare']>>; edges: Map<number, ReturnType<MonographDb['prepare']>> };
}

export function extractInducedSubgraph(db: MonographDb, nodeIds: string[]): InducedSubgraph {
  if (nodeIds.length === 0) return { nodes: [], edges: [] };

  const stmts = getStmtCaches(db);

  // Chunk helper — caches prepared statements by chunk size to avoid re-prepare per call.
  function queryChunked<T>(ids: string[], chunkSize: number, stmtCache: Map<number, Database.Statement>, sql: (ph: string) => string): T[] {
    const results: T[] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const ph = placeholders(chunk.length);
      let stmt = stmtCache.get(chunk.length);
      if (!stmt) { stmt = db.prepare(sql(ph)); stmtCache.set(chunk.length, stmt); }
      results.push(...(stmt.all(...chunk) as T[]));
    }
    return results;
  }

  const rawNodes = queryChunked<RawNode>(
    nodeIds,
    SQLITE_VAR_LIMIT,
    stmts.nodes,
    ph => `SELECT id, label, name, file_path, start_line, end_line, community_id, is_exported, language, properties FROM nodes WHERE id IN (${ph})`,
  );

  // For edges: query by source_id chunks (1 bind per row), then filter target in-memory.
  const nodeSet = new Set(nodeIds);
  const allSourceEdges = queryChunked<RawEdge>(
    nodeIds,
    SQLITE_VAR_LIMIT,
    stmts.edges,
    // Drop unused 'evidence' column to reduce row data transfer
    ph => `SELECT id, source_id, target_id, relation, confidence, confidence_score, reason FROM edges WHERE source_id IN (${ph})`,
  );
  const rawEdges = allSourceEdges.filter(e => nodeSet.has(e.target_id));

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

/**
 * Format an InducedSubgraph as structured text for LLM consumption.
 * Groups nodes by file path and lists edges with relation + file:line hints.
 */
export function formatInducedSubgraph(sg: InducedSubgraph): string {
  if (sg.nodes.length === 0) return 'Subgraph is empty.';

  const lines: string[] = [`Subgraph: ${sg.nodes.length} nodes, ${sg.edges.length} edges`];

  // Group nodes by file
  const byFile = new Map<string, MonographNode[]>();
  for (const n of sg.nodes) {
    const file = n.filePath ?? '(unknown)';
    let list = byFile.get(file);
    if (!list) { list = []; byFile.set(file, list); }
    list.push(n);
  }

  lines.push('\nNodes:');
  for (const [file, nodes] of byFile) {
    lines.push(`  ${file}`);
    for (const n of nodes) {
      const loc = n.startLine ? `:${n.startLine}` : '';
      lines.push(`    ${n.label} ${n.name}${loc}`);
    }
  }

  if (sg.edges.length > 0) {
    lines.push('\nEdges:');
    for (const e of sg.edges) {
      lines.push(`  ${e.sourceId} --[${e.relation}]--> ${e.targetId}`);
    }
  }

  return lines.join('\n');
}
