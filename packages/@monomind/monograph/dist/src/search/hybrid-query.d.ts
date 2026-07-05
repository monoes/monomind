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
export declare function hybridQuery(db: Database.Database, query: string, options?: HybridQueryOptions): Promise<HybridResult[]>;
//# sourceMappingURL=hybrid-query.d.ts.map