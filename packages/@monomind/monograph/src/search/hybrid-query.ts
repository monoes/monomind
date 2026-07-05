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

export interface HybridQueryOptions {
  limit?: number;
  label?: string;
  /** @deprecated Embeddings are disabled — this option is ignored; search is BM25-only. */
  embedder?: unknown;
}

export interface HybridResult extends RankedResult {
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

/**
 * Run a BM25 (FTS5) search. Despite the name, this is BM25-only — the
 * vector branch was removed; the `embedder` option is ignored.
 */
export async function hybridQuery(
  db: Database.Database,
  query: string,
  options: HybridQueryOptions = {},
): Promise<HybridResult[]> {
  const { limit = 20, label } = options;

  // Normalize the query for text-based lookups (strip diacritics, lowercase, trim)
  const normalizedQuery = normalizeSearchTerm(query);

  // ── BM25 via FTS5 ──────────────────────────────────────────────────────────
  const bm25Limit = 50;
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

  return bm25Results.slice(0, limit) as HybridResult[];
}
