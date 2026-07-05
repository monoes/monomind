/**
 * BM25 search (FTS5) with the historical "hybrid" entry-point signature.
 *
 * Monograph search is BM25-only. The former embedding/vector branch
 * (gated on MONOGRAPH_EMBEDDINGS=true) was removed — it was never run in
 * practice (the embeddings table stayed empty) and did a JS cosine full
 * scan. The exported function signatures are unchanged so callers do not
 * need to change.
 */
import { ftsSearch } from '../storage/fts-store.js';
import { normalizeSearchTerm } from './diacritic.js';
/**
 * Run a BM25 (FTS5) search. Despite the name, this is BM25-only — the
 * vector branch was removed; the `embedder` option is ignored.
 */
export async function hybridQuery(db, query, options = {}) {
    const { limit = 20, label } = options;
    // Normalize the query for text-based lookups (strip diacritics, lowercase, trim)
    const normalizedQuery = normalizeSearchTerm(query);
    // ── BM25 via FTS5 ──────────────────────────────────────────────────────────
    const bm25Limit = 50;
    const bm25Raw = ftsSearch(db, normalizedQuery, bm25Limit, label);
    const bm25Results = bm25Raw.map((r) => ({
        id: r.id,
        name: r.name,
        normLabel: r.normLabel,
        filePath: r.filePath,
        label: r.label,
        score: r.rank,
        startLine: r.startLine,
        endLine: r.endLine,
    }));
    return bm25Results.slice(0, limit);
}
//# sourceMappingURL=hybrid-query.js.map