import Database from 'better-sqlite3';
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
// Per-DB statement cache — avoids recompiling SQL on every pageRank() call.
// ---------------------------------------------------------------------------
interface StmtCache {
  selectNodes: Database.Statement;
  selectEdges: Database.Statement;
}

const _stmtCache = new Map<string, StmtCache>();

function getStmts(db: MonographDb): StmtCache {
  const key = (db as unknown as { name: string }).name ?? '__default__';
  let cache = _stmtCache.get(key);
  if (!cache) {
    cache = {
      selectNodes: db.prepare('SELECT id FROM nodes'),
      selectEdges: db.prepare('SELECT source_id, target_id FROM edges'),
    };
    _stmtCache.set(key, cache);
  }
  return cache;
}

// ---------------------------------------------------------------------------
// Result cache — avoids re-running power iteration when the graph hasn't
// changed. Keyed by (dbName, nodeCount, edgeCount) with a 5-second TTL.
// ---------------------------------------------------------------------------
const PAGERANK_CACHE_TTL_MS = 5_000;

interface PageRankCacheEntry {
  result: Map<string, number>;
  expiresAt: number;
}

const _resultCache = new Map<string, PageRankCacheEntry>();

function resultCacheKey(db: MonographDb, nodeCount: number, edgeCount: number): string {
  const name = (db as unknown as { name: string }).name ?? '__default__';
  return `${name}:${nodeCount}:${edgeCount}`;
}

/**
 * Evict cached statements and results for a given DB instance (call after writes).
 */
export function invalidatePageRankCache(db: MonographDb): void {
  const key = (db as unknown as { name: string }).name ?? '__default__';
  _stmtCache.delete(key);
  // Purge all result-cache entries for this DB (they have the name as prefix)
  for (const k of _resultCache.keys()) {
    if (k.startsWith(`${key}:`)) _resultCache.delete(k);
  }
}

/**
 * Compute PageRank scores for all nodes using power iteration.
 *
 * Each node's score is initialized to 1/N (so scores sum to 1).
 * After convergence the scores still sum to ~1 (standard normalized PageRank).
 * Dangling nodes (out-degree 0) distribute their rank equally to all nodes.
 *
 * Results are cached for 5 seconds when the graph's node+edge counts are
 * unchanged, making repeated calls (e.g. during context preloading) free.
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

  // Check result cache before running power iteration
  const cacheKey = resultCacheKey(db, nodeRows.length, edgeRows.length);
  const now = Date.now();
  const cached = _resultCache.get(cacheKey);
  if (cached && now < cached.expiresAt) return cached.result;

  const nodes = nodeRows.map(r => r.id);
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

  // Store in result cache
  _resultCache.set(cacheKey, { result, expiresAt: now + PAGERANK_CACHE_TTL_MS });

  return result;
}
