import type Database from 'better-sqlite3';
/**
 * CRUD operations for the embeddings table.
 *
 * Vectors are stored as BLOBs (raw Float32Array bytes) and reconstructed on read.
 */
export declare function upsertEmbedding(db: Database.Database, nodeId: string, vector: Float32Array, contentHash?: string): void;
export declare function getEmbeddingContentHash(db: Database.Database, nodeId: string): string | null;
export declare function isEmbeddingStale(db: Database.Database, nodeId: string, currentHash: string): boolean;
export declare function getEmbedding(db: Database.Database, nodeId: string): Float32Array | null;
export declare function getAllEmbeddings(db: Database.Database): Map<string, Float32Array>;
export declare function countEmbeddings(db: Database.Database): number;
//# sourceMappingURL=embedding-store.d.ts.map