import type Database from 'better-sqlite3';
export interface FtsResult {
    id: string;
    name: string;
    normLabel: string;
    filePath: string | null;
    label: string;
    rank: number;
}
export declare function ftsSearch(db: Database.Database, query: string, limit: number, label?: string): FtsResult[];
export interface HybridSearchResult extends FtsResult {
    combinedScore: number;
    matchStrategy: 'fts' | 'like' | 'fuzzy';
}
/**
 * Hybrid search combining three strategies:
 *  1. FTS5 (trigram) BM25 match via `ftsSearch`
 *  2. LIKE fallback for short queries (≤3 chars) or when FTS returns 0 results
 *  3. In-memory fuzzy character-sequence scoring applied to all candidates
 *
 * Results are deduped by id (highest combinedScore wins), re-ranked, and
 * trimmed to `limit`. The existing `ftsSearch` is left unchanged.
 */
export declare function hybridSearch(db: Database.Database, query: string, limit: number, label?: string): HybridSearchResult[];
//# sourceMappingURL=fts-store.d.ts.map