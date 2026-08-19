/**
 * BM25 search (FTS5) with the historical "hybrid" entry-point signature.
 *
 * Monograph search is BM25-only. The former embedding/vector branch
 * (gated on MONOGRAPH_EMBEDDINGS=true) was removed — it was never run in
 * practice (the embeddings table stayed empty) and did a JS cosine full
 * scan. The exported function signatures are unchanged so callers do not
 * need to change.
 */

import type Database from 'better-sqlite3';
import type { RankedResult } from './rrf.js';
import { ftsSearch } from '../storage/fts-store.js';
import { normalizeSearchTerm } from './diacritic.js';

export interface BM25QueryOptions {
  limit?: number;
  label?: string;
  /** @deprecated Embeddings are disabled — this option is ignored; search is BM25-only. Will be removed in the next major version. */
  embedder?: unknown;
}

/** @deprecated Use {@link BM25QueryOptions} — this alias will be removed in the next major version. */
export type HybridQueryOptions = BM25QueryOptions;

export interface BM25Result extends RankedResult {
  id: string;
  name: string;
  normLabel: string;
  filePath: string | null;
  label: string;
  score: number;
  /** First line of the symbol in its source file (1-based, null if unknown). */
  startLine?: number | null;
  /** Last line of the symbol in its source file (1-based, null if unknown). */
  endLine?: number | null;
}

/** @deprecated Use {@link BM25Result} — this alias will be removed in the next major version. */
export type HybridResult = BM25Result;

/**
 * Run a BM25 (FTS5) search. The `embedder` option is ignored — the vector
 * branch was removed; search is BM25-only.
 */
export async function bm25Query(
  db: Database.Database,
  query: string,
  options: BM25QueryOptions = {},
): Promise<BM25Result[]> {
  const { limit = 20, label } = options;

  // Normalize the query for text-based lookups (strip diacritics, lowercase, trim)
  const normalizedQuery = normalizeSearchTerm(query);

  // ── BM25 via FTS5 ──────────────────────────────────────────────────────────
  const bm25Limit = Math.max(limit, 50);
  const bm25Raw = ftsSearch(db, normalizedQuery, bm25Limit, label);
  const bm25Results: RankedResult[] = bm25Raw.map((r) => ({
    id: r.id,
    name: r.name,
    normLabel: r.normLabel,
    filePath: r.filePath,
    label: r.label,
    score: r.rank,
    startLine: r.startLine,
    endLine: r.endLine,
  }));

  return bm25Results.slice(0, limit) as BM25Result[];
}

/**
 * @deprecated Use {@link bm25Query} instead — this is a misleading name
 * (search here is BM25-only, not a hybrid of multiple retrieval strategies).
 * `hybridQuery` remains as an alias for backward compatibility and will be
 * removed in the next major version.
 */
export const hybridQuery = bm25Query;
