/**
 * Hybrid BM25 + vector search with Reciprocal Rank Fusion.
 *
 * When MONOGRAPH_EMBEDDINGS=true (or an embedder is provided), the query is
 * embedded and cosine similarity is computed in JavaScript against all stored
 * vectors.  Both result lists are merged via RRF(K=60).
 *
 * If embeddings are unavailable (table empty, env not set, no embedder),
 * the function falls back to BM25 only — same behaviour as before.
 */

import type Database from 'better-sqlite3';
import type { EmbedderFn } from './embedder.js';
import { mergeRanks, type RankedResult } from './rrf.js';
import { getAllEmbeddings, countEmbeddings } from '../storage/embedding-store.js';
import { embedText } from './embedder.js';
import { ftsSearch } from '../storage/fts-store.js';
import { normalizeSearchTerm } from './diacritic.js';

export interface HybridQueryOptions {
  limit?: number;
  label?: string;
  /** Explicit embedder — overrides MONOGRAPH_EMBEDDINGS env check */
  embedder?: EmbedderFn;
}

export interface HybridResult extends RankedResult {
  id: string;
  name: string;
  normLabel: string;
  filePath: string | null;
  label: string;
  score: number;
}

/**
 * Run a hybrid BM25 + cosine search.
 *
 * Falls back to BM25-only when:
 *  - MONOGRAPH_EMBEDDINGS env var is not 'true' AND no explicit embedder is given
 *  - The embeddings table is empty
 *  - Embedding the query string fails
 */
export async function hybridQuery(
  db: Database.Database,
  query: string,
  options: HybridQueryOptions = {},
): Promise<HybridResult[]> {
  const { limit = 20, label, embedder } = options;

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
  }));

  // ── Decide whether to add vector results ──────────────────────────────────
  const embeddingsEnabled =
    embedder !== undefined || process.env['MONOGRAPH_EMBEDDINGS'] === 'true';

  if (!embeddingsEnabled) return sliceHybrid(bm25Results, limit);

  const embeddingCount = countEmbeddings(db);
  if (embeddingCount === 0) return sliceHybrid(bm25Results, limit);

  // ── Embed the query ────────────────────────────────────────────────────────
  let queryVec: Float32Array;
  try {
    const fn: import('./embedder.js').EmbedderFn = embedder ?? (await import('./embedder.js').then((m) => m.getEmbedder()));
    queryVec = await embedText(normalizedQuery, fn);
  } catch {
    // Embedding failed — degrade gracefully to BM25
    return sliceHybrid(bm25Results, limit);
  }

  // ── Cosine similarity against stored vectors ──────────────────────────────
  const allVecs = getAllEmbeddings(db);
  const vectorScored: { id: string; cosine: number }[] = [];

  for (const [nodeId, vec] of allVecs) {
    const sim = dotProduct(queryVec, vec); // valid because vectors are L2-normalised
    vectorScored.push({ id: nodeId, cosine: sim });
  }

  // Sort descending by cosine similarity
  vectorScored.sort((a, b) => b.cosine - a.cosine);

  // Build vector RankedResult list with node metadata joined from BM25 cache
  const bm25ById = new Map(bm25Results.map((r) => [r.id, r]));
  const vectorResults: RankedResult[] = vectorScored.map((vs) => {
    const meta = bm25ById.get(vs.id);
    return {
      id: vs.id,
      name: (meta?.name as string | undefined) ?? '',
      normLabel: (meta?.normLabel as string | undefined) ?? '',
      filePath: (meta?.filePath as string | null | undefined) ?? null,
      label: (meta?.label as string | undefined) ?? '',
      score: vs.cosine,
    };
  });

  // ── Merge via RRF ──────────────────────────────────────────────────────────
  const merged = mergeRanks(bm25Results, vectorResults);

  // Enrich nodes not in bm25 cache with a DB lookup
  const enrichable = merged as Partial<HybridResult>[];
  const unknownIds = enrichable
    .filter((r) => !r.name)
    .map((r) => r.id as string);

  if (unknownIds.length > 0) {
    const placeholders = unknownIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT id, name, norm_label, file_path, label FROM nodes WHERE id IN (${placeholders})`,
      )
      .all(...unknownIds) as {
      id: string;
      name: string;
      norm_label: string;
      file_path: string | null;
      label: string;
    }[];

    const rowMap = new Map(rows.map((r) => [r.id, r]));
    for (const item of enrichable) {
      if (!item.name) {
        const row = rowMap.get(item.id as string);
        if (row) {
          item.name = row.name;
          item.normLabel = row.norm_label;
          item.filePath = row.file_path;
          item.label = row.label;
        }
      }
    }
  }

  return sliceHybrid(merged, limit);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sliceHybrid(results: RankedResult[], limit: number): HybridResult[] {
  return results.slice(0, limit) as HybridResult[];
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}
