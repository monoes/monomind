import type Database from 'better-sqlite3';
import type { MonographDb } from '../storage/db.js';

export interface PageRankOptions {
  /** Damping factor (probability of following an edge). Default: 0.85 */
  dampingFactor?: number;
  /** Maximum number of power-iteration steps. Default: 100 */
  maxIterations?: number;
  /** Convergence threshold (L1 norm delta). Default: 1e-6 */
  tolerance?: number;
}

// ---------------------------------------------------------------------------
// Per-connection statement cache — avoids recompiling SQL on every pageRank()
// call. Prepared statements belong to the connection that compiled them, so
// this is keyed by the connection object (never by database name: a new
// connection to the same path would otherwise reuse statements bound to a
// closed one). A WeakMap also lets entries go when the connection is dropped.
// ---------------------------------------------------------------------------
interface StmtCache {
  selectNodes: Database.Statement;
  selectEdges: Database.Statement;
}

const _stmtCache = new WeakMap<MonographDb, StmtCache>();

function getStmts(db: MonographDb): StmtCache {
  let cache = _stmtCache.get(db);
  if (!cache) {
    cache = {
      selectNodes: db.prepare('SELECT id FROM nodes'),
      selectEdges: db.prepare('SELECT source_id, target_id FROM edges'),
    };
    _stmtCache.set(db, cache);
  }
  return cache;
}

// ---------------------------------------------------------------------------
// Result cache — avoids re-running power iteration when the graph and the
// algorithm options are both unchanged. Also keyed per connection, with an
// inner key of (graph revision, options) and a 5-second TTL.
// ---------------------------------------------------------------------------
const PAGERANK_CACHE_TTL_MS = 5_000;
const MAX_RESULT_CACHE = 50;

interface PageRankCacheEntry {
  result: Map<string, number>;
  expiresAt: number;
}

const _resultCache = new WeakMap<MonographDb, Map<string, PageRankCacheEntry>>();

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Cheap content revision for the graph that was just read.
 *
 * There is no persisted graph-generation counter in the schema, and node/edge
 * counts alone are not a topology marker: a graph can be rewired (edges moved
 * between nodes) without either count changing. Both row sets have already
 * been fetched by the time this runs, so hashing them costs O(N+E) — the same
 * order as the fetch itself, and far less than the power iteration it guards.
 *
 * Row order is not guaranteed by SQLite; a reordering only produces a cache
 * miss (a recompute), never a stale hit.
 */
function graphRevision(
  nodeRows: { id: string }[],
  edgeRows: { source_id: string; target_id: string }[],
): string {
  let h1 = FNV_OFFSET;
  let h2 = 0xcbf29ce4;
  const byte = (c: number): void => {
    h1 = Math.imul(h1 ^ c, FNV_PRIME);
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13);
  };
  const field = (s: string): void => {
    for (let i = 0; i < s.length; i++) byte(s.charCodeAt(i));
    byte(0x1f); // field separator — keeps ("ab","c") distinct from ("a","bc")
  };
  for (const r of nodeRows) field(r.id);
  for (const e of edgeRows) {
    field(e.source_id);
    field(e.target_id);
  }
  const hex = ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).padStart(2, '0');
  return `${hex}:${nodeRows.length}:${edgeRows.length}`;
}

/**
 * Evict cached statements and results for a given DB connection (call after writes).
 *
 * Closing a connection needs no explicit call: both caches are keyed by the
 * connection object, so a reopened database gets freshly prepared statements
 * and an empty result cache.
 */
export function invalidatePageRankCache(db: MonographDb): void {
  _stmtCache.delete(db);
  _resultCache.delete(db);
}

/**
 * Compute PageRank scores for all nodes using power iteration.
 *
 * Each node's score is initialized to 1/N (so scores sum to 1).
 * After convergence the scores still sum to ~1 (standard normalized PageRank).
 * Dangling nodes (out-degree 0) distribute their rank equally to all nodes.
 *
 * Results are cached for 5 seconds per connection when both the graph's
 * content revision and the algorithm options are unchanged, making repeated
 * calls (e.g. during context preloading) free. Each call returns its own Map,
 * so a caller mutating the result cannot corrupt another caller's copy.
 *
 * @param db - The MonographDb instance
 * @param options - Optional tuning parameters
 * @returns Map of nodeId → PageRank score
 */
export function pageRank(db: MonographDb, options: PageRankOptions = {}): Map<string, number> {
  const { dampingFactor = 0.85, maxIterations = 100, tolerance = 1e-6 } = options;

  const stmts = getStmts(db);
  const nodeRows = stmts.selectNodes.all() as { id: string }[];
  const edgeRows = stmts.selectEdges.all() as {
    source_id: string;
    target_id: string;
  }[];

  if (nodeRows.length === 0) return new Map();

  // Check result cache before running power iteration. The key covers both the
  // graph's content revision and every option that changes the output, so a
  // rewired graph or a different damping factor can never hit a stale entry.
  const cacheKey = `${graphRevision(nodeRows, edgeRows)}|${dampingFactor}|${maxIterations}|${tolerance}`;
  const now = Date.now();
  let dbCache = _resultCache.get(db);
  const cached = dbCache?.get(cacheKey);
  if (cached && now < cached.expiresAt) return new Map(cached.result);

  const nodes = nodeRows.map((r) => r.id);
  const n = nodes.length;
  const nodeIndex = new Map<string, number>();
  nodes.forEach((id, i) => nodeIndex.set(id, i));

  // Build adjacency: outEdges[i] = list of target indices
  const outEdges: number[][] = nodes.map(() => []);
  const inEdges: number[][] = nodes.map(() => []);

  for (const { source_id: src, target_id: tgt } of edgeRows) {
    if (src === tgt) continue;
    const si = nodeIndex.get(src);
    const ti = nodeIndex.get(tgt);
    if (si === undefined || ti === undefined) continue;
    outEdges[si].push(ti);
    inEdges[ti].push(si);
  }

  // Power iteration — initialize to uniform 1/N so scores sum to 1
  let scores = new Float64Array(n).fill(1 / n);
  const dangling1OverN = (1 - dampingFactor) / n;

  for (let iter = 0; iter < maxIterations; iter++) {
    const newScores = new Float64Array(n);

    // Collect dangling node contribution
    let danglingSum = 0;
    for (let i = 0; i < n; i++) {
      if (outEdges[i].length === 0) danglingSum += scores[i];
    }
    const danglingContrib = (dampingFactor * danglingSum) / n;

    for (let i = 0; i < n; i++) {
      let incoming = 0;
      for (const j of inEdges[i]) {
        incoming += scores[j] / outEdges[j].length;
      }
      newScores[i] = dangling1OverN + dampingFactor * incoming + danglingContrib;
    }

    // Check convergence
    let delta = 0;
    for (let i = 0; i < n; i++) {
      delta += Math.abs(newScores[i] - scores[i]);
    }
    scores = newScores;
    if (delta < tolerance) break;
  }

  const result = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    result.set(nodes[i], scores[i]);
  }

  if (!dbCache) {
    dbCache = new Map();
    _resultCache.set(db, dbCache);
  }
  if (dbCache.size >= MAX_RESULT_CACHE) {
    const oldest = dbCache.keys().next().value!;
    dbCache.delete(oldest);
  }
  dbCache.set(cacheKey, { result, expiresAt: now + PAGERANK_CACHE_TTL_MS });

  // Hand out a copy so a caller mutating its result can't corrupt the cache.
  return new Map(result);
}
