/**
 * JSONL-backed knowledge store for per-agent knowledge base.
 *
 * Stores document metadata and text chunks as JSON-lines files,
 * avoiding any native SQLite dependency.
 *
 * @module @monobrain/memory/knowledge/knowledge-store
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { chunkDocument, type TextChunk } from './document-chunker.js';

/** Metadata record persisted in metadata.jsonl */
export interface MetadataRecord {
  filePath: string;
  scope: string;
  contentHash: string;
  chunkCount: number;
  indexedAt: string;
}

/** Chunk record persisted in chunks.jsonl */
export interface ChunkRecord {
  chunkId: string;
  namespace: string;
  text: string;
  metadata: Record<string, unknown>;
}

export class KnowledgeStore {
  private readonly dirPath: string;

  constructor(dirPath: string) {
    this.dirPath = dirPath;
    fs.mkdirSync(dirPath, { recursive: true });
  }

  /**
   * Map a scope string to a knowledge-namespaced partition name.
   */
  getPartitionNamespace(scope: string): string {
    return scope === 'shared' ? 'knowledge:shared' : `knowledge:${scope}`;
  }

  /**
   * Check whether a file needs to be (re-)indexed by comparing its current
   * content hash against the stored hash.
   */
  documentNeedsReindex(filePath: string, scope: string): boolean {
    const currentHash = this.hashFile(filePath);
    const stored = this.findMetadata(filePath, scope);
    if (!stored) return true;
    return stored.contentHash !== currentHash;
  }

  /**
   * Index a document: read it, hash, chunk, and persist metadata + chunks as JSONL.
   */
  indexDocument(filePath: string, scope: string): { chunksIndexed: number } {
    const content = fs.readFileSync(filePath, 'utf-8');
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const namespace = this.getPartitionNamespace(scope);
    const docId = `${scope}:${filePath}`;

    // Remove any existing data for this doc before re-indexing
    this.removeDocument(filePath, scope);

    const chunks: TextChunk[] = chunkDocument(docId, content);

    // Persist chunk records
    for (const chunk of chunks) {
      const record: ChunkRecord = {
        chunkId: chunk.chunkId,
        namespace,
        text: chunk.text,
        metadata: {
          filePath,
          scope,
          docId,
          chunkIndex: chunk.chunkIndex,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
        },
      };
      this.appendJsonl(this.chunksPath(), record);
    }

    // Persist metadata
    const meta: MetadataRecord = {
      filePath,
      scope,
      contentHash,
      chunkCount: chunks.length,
      indexedAt: new Date().toISOString(),
    };
    this.appendJsonl(this.metadataPath(), meta);

    return { chunksIndexed: chunks.length };
  }

  /**
   * Remove all stored data (chunks + metadata) for a given document/scope.
   */
  removeDocument(filePath: string, scope: string): void {
    const namespace = this.getPartitionNamespace(scope);

    // Filter out matching metadata records
    this.filterJsonl<MetadataRecord>(
      this.metadataPath(),
      (r) => !(r.filePath === filePath && r.scope === scope),
    );

    // Filter out matching chunk records
    this.filterJsonl<ChunkRecord>(
      this.chunksPath(),
      (r) => !(r.namespace === namespace && (r.metadata?.filePath as string) === filePath),
    );
  }

  /**
   * Read all chunk records for a given namespace.
   */
  getChunks(namespace: string): ChunkRecord[] {
    return this.readJsonl<ChunkRecord>(this.chunksPath()).filter(
      (r) => r.namespace === namespace,
    );
  }

  // ── private helpers ──────────────────────────────────────────────

  private metadataPath(): string {
    return path.join(this.dirPath, 'metadata.jsonl');
  }

  private chunksPath(): string {
    return path.join(this.dirPath, 'chunks.jsonl');
  }

  private hashFile(filePath: string): string {
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private findMetadata(filePath: string, scope: string): MetadataRecord | undefined {
    const records = this.readJsonl<MetadataRecord>(this.metadataPath());
    return records.find((r) => r.filePath === filePath && r.scope === scope);
  }

  private appendJsonl<T>(file: string, record: T): void {
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf-8');
  }

  private readJsonl<T>(file: string): T[] {
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    return lines.map((line) => JSON.parse(line) as T);
  }

  private filterJsonl<T>(file: string, predicate: (record: T) => boolean): void {
    const records = this.readJsonl<T>(file);
    const filtered = records.filter(predicate);
    fs.writeFileSync(file, filtered.map((r) => JSON.stringify(r)).join('\n') + (filtered.length ? '\n' : ''), 'utf-8');
  }
}
