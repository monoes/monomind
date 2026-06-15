import type Database from 'better-sqlite3';
/**
 * CRUD operations for the embeddings table.
 *
 * Vectors are stored as BLOBs (raw Float32Array bytes) and reconstructed on read.
 */
/**
 * Ensure the embeddings table has the content_hash column introduced in a later
 * schema version. Call this ONCE before a batch of upserts rather than inside
 * upsertEmbedding itself to avoid running ALTER TABLE on every row write.
 */
export declare function ensureEmbeddingSchema(db: Database.Database): void;
export declare function upsertEmbedding(db: Database.Database, nodeId: string, vector: Float32Array, contentHash?: string): void;
/**
 * Bulk-upsert multiple embeddings in a single transaction.
 * Calls ensureEmbeddingSchema once before writing, then wraps all inserts in
 * a transaction for 10-100x faster throughput vs per-row upsertEmbedding calls.
 */
export declare function batchUpsertEmbeddings(db: Database.Database, entries: Array<{
    nodeId: string;
    vector: Float32Array;
    contentHash?: string;
}>): void;
export declare function getEmbeddingContentHash(db: Database.Database, nodeId: string): string | null;
export declare function isEmbeddingStale(db: Database.Database, nodeId: string, currentHash: string): boolean;
export declare function getEmbedding(db: Database.Database, nodeId: string): Float32Array | null;
export declare function getAllEmbeddings(db: Database.Database): Map<string, Float32Array>;
export declare function countEmbeddings(db: Database.Database): number;
//# sourceMappingURL=embedding-store.d.ts.map