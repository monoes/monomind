/**
 * The single lexical retrieval service for the monograph knowledge graph.
 *
 * Every adapter — the package-level `monograph_query` MCP tool, the
 * CLI-hosted `monograph_query` MCP tool, `augmentContext`, the eval server —
 * calls {@link searchGraph} rather than assembling its own BM25/LIKE/fuzzy
 * combination. Two adapters answering the same query differently was a real
 * bug, not a hypothetical one.
 *
 * SCORE CONVENTION — higher is better, always non-negative.
 * SQLite FTS5's `rank` is the opposite (negative, more negative = better).
 * That inversion is resolved in exactly one place,
 * {@link relevanceFromFtsRank} in `../storage/fts-store.js`, at the boundary
 * where a rank enters the system. Nothing downstream ever sees a raw rank, so
 * the sign cannot be forwarded into a ranker again.
 *
 * Monograph search is lexical-only. The former embedding/vector branch
 * (gated on MONOGRAPH_EMBEDDINGS=true) was removed — it was never run in
 * practice (the embeddings table stayed empty) and did a JS cosine full scan.
 */

import type Database from 'better-sqlite3';
import { ftsSearch, hybridSearch, relevanceFromFtsRank } from '../storage/fts-store.js';
import type { RankedResult } from './rrf.js';

/**
 * Retrieval strategies, named for what they actually do.
 *
 * - `hybrid` — FTS5 BM25 + LIKE fallback + in-memory fuzzy + node-type bonus.
 *   The default: it degrades gracefully on short identifiers, where bare BM25
 *   over a trigram index returns nothing.
 * - `bm25` — FTS5 BM25 only. Narrower, but predictable; used where a caller
 *   wants pure lexical ranking with no heuristic bonuses.
 */
export type RetrievalMode = 'bm25' | 'hybrid';

export interface GraphSearchOptions {
  limit?: number;
  label?: string;
  /** Retrieval strategy (default: `hybrid`). */
  mode?: RetrievalMode;
}

export interface GraphSearchResult {
  id: string;
  name: string;
  normLabel: string;
  filePath: string | null;
  label: string;
  /** Higher is better, always ≥ 0. See the score-convention note above. */
  relevance: number;
  /** First line of the symbol in its source file (1-based, null if unknown). */
  startLine: number | null;
  /** Last line of the symbol in its source file (1-based, null if unknown). */
  endLine: number | null;
  /** Which retrieval strategy surfaced this row. */
  matchStrategy: 'fts' | 'like' | 'fuzzy';
}

/**
 * Run a lexical search over the graph and return results under the
 * higher-is-better score convention.
 *
 * The query is prepared identically for every mode so that two adapters
 * asking the same question in the same mode get the same answer.
 *
 * Preparation is `trim()` only, deliberately. The FTS5 index uses the trigram
 * tokenizer, which folds ASCII case but does NOT fold diacritics, and the
 * index stores `name`/`norm_label` verbatim. Stripping diacritics from the
 * query (as the old `bm25Query` did) therefore could never *gain* a match —
 * it only stopped `naïveResolver` from finding the symbol literally named
 * `naïveResolver`. Lowercasing is likewise skipped: it is a no-op for ASCII
 * under both the trigram tokenizer and SQLite's LIKE, and for non-ASCII it
 * would break the LIKE fallback against a capitalized name.
 */
export function searchGraph(
  db: Database.Database,
  query: string,
  options: GraphSearchOptions = {},
): GraphSearchResult[] {
  const { limit = 20, label, mode = 'hybrid' } = options;
  if (limit <= 0) return [];

  const normalizedQuery = (query ?? '').trim();
  if (!normalizedQuery) return [];

  if (mode === 'bm25') {
    // Over-fetch a little: FTS5's own ordering is what we keep, but a wider
    // window gives the caller's label filter something to bite on.
    const rows = ftsSearch(db, normalizedQuery, Math.max(limit, 50), label);
    return rows.slice(0, limit).map((r) => ({
      id: r.id,
      name: r.name,
      normLabel: r.normLabel,
      filePath: r.filePath,
      label: r.label,
      relevance: relevanceFromFtsRank(r.rank),
      startLine: r.startLine,
      endLine: r.endLine,
      matchStrategy: 'fts' as const,
    }));
  }

  // hybridSearch already reports a positive, higher-is-better combinedScore
  // (it routes its FTS rows through relevanceFromFtsRank).
  return hybridSearch(db, normalizedQuery, limit, label).map((r) => ({
    id: r.id,
    name: r.name,
    normLabel: r.normLabel,
    filePath: r.filePath,
    label: r.label,
    relevance: r.combinedScore,
    startLine: r.startLine,
    endLine: r.endLine,
    matchStrategy: r.matchStrategy,
  }));
}

export interface BM25QueryOptions {
  limit?: number;
  label?: string;
  /** @deprecated Embeddings are disabled — this option is ignored; search is lexical-only. Will be removed in the next major version. */
  embedder?: unknown;
}

/** @deprecated Use {@link GraphSearchOptions} — this alias will be removed in the next major version. */
export type HybridQueryOptions = BM25QueryOptions;

export interface BM25Result extends RankedResult {
  id: string;
  name: string;
  normLabel: string;
  filePath: string | null;
  label: string;
  /** Higher is better, always ≥ 0 — see the score-convention note above. */
  score: number;
  /** First line of the symbol in its source file (1-based, null if unknown). */
  startLine?: number | null;
  /** Last line of the symbol in its source file (1-based, null if unknown). */
  endLine?: number | null;
}

/** @deprecated Use {@link GraphSearchResult} — this alias will be removed in the next major version. */
export type HybridResult = BM25Result;

/**
 * @deprecated Use {@link searchGraph} with `mode: 'bm25'`. Retained as a thin
 * wrapper so existing callers keep working; it now reports the same
 * higher-is-better `score` as every other path (it used to forward FTS5's
 * raw negative `rank`, which inverted ranking for anything downstream that
 * compared or propagated scores).
 */
export async function bm25Query(
  db: Database.Database,
  query: string,
  options: BM25QueryOptions = {},
): Promise<BM25Result[]> {
  const { limit = 20, label } = options;
  return searchGraph(db, query, { limit, label, mode: 'bm25' }).map((r) => ({
    id: r.id,
    name: r.name,
    normLabel: r.normLabel,
    filePath: r.filePath,
    label: r.label,
    score: r.relevance,
    startLine: r.startLine,
    endLine: r.endLine,
  }));
}

/**
 * @deprecated Use {@link searchGraph} instead — this is a misleading name
 * (search here is lexical-only, not a hybrid of multiple retrieval
 * *modalities*). `hybridQuery` remains as an alias for backward compatibility
 * and will be removed in the next major version.
 */
export const hybridQuery = bm25Query;
