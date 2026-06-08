import type Database from 'better-sqlite3';
export interface ExactSearchResult {
    id: string;
    score: number;
}
export interface ExactSearchOptions {
    limit?: number;
}
export declare function exactVectorSearch(db: Database.Database, queryVector: Float32Array, options?: ExactSearchOptions): ExactSearchResult[];
//# sourceMappingURL=exact-search.d.ts.map