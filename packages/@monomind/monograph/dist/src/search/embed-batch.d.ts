/**
 * Batch-embed all symbol nodes that don't yet have an embedding stored.
 */
import type Database from 'better-sqlite3';
import type { EmbedderFn } from './embedder.js';
import type { EmbedDeviceConfig } from './device-config.js';
import type { HttpEmbedderConfig } from './http-embedder.js';
import { countEmbeddings } from '../storage/embedding-store.js';
export interface EmbedBatchConfig {
    device?: EmbedDeviceConfig;
    remote?: HttpEmbedderConfig;
    batchSize?: number;
}
/**
 * Embed a list of text strings and return an array of embedding vectors.
 *
 * If `config.remote` is provided, delegates to `HttpEmbedder`.
 * Otherwise falls back to the local HuggingFace embedder.
 *
 * @param texts  - Strings to embed
 * @param config - Optional device/remote/batchSize config
 */
export declare function embedBatch(texts: string[], config?: EmbedBatchConfig): Promise<number[][]>;
export interface EmbedAllResult {
    embedded: number;
    skipped: number;
}
export declare function embedAll(db: Database.Database, embedder: EmbedderFn, force?: boolean, codeOnly?: boolean): Promise<EmbedAllResult>;
export { countEmbeddings };
//# sourceMappingURL=embed-batch.d.ts.map