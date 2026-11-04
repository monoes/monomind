/**
 * Simple in-memory vector store for standalone usage
 * Replace with LanceDB in production
 *
 * File-size sweep: split out of threat-learning-service.ts.
 */

import type { VectorStore } from './threat-learning-service.js';

interface StoredEntry {
  value: unknown;
  embedding?: number[];
  expiresAt?: number;
}

export class InMemoryVectorStore implements VectorStore {
  private storage = new Map<string, Map<string, StoredEntry>>();

  async store(params: {
    namespace: string;
    key: string;
    value: unknown;
    embedding?: number[];
    ttl?: number;
  }): Promise<void> {
    if (!this.storage.has(params.namespace)) {
      this.storage.set(params.namespace, new Map());
    }
    const ns = this.storage.get(params.namespace)!;
    // Lazy TTL eviction: opportunistically prune expired entries in this
    // namespace on every write, rather than running a background timer.
    this.pruneExpired(ns);
    ns.set(params.key, {
      value: params.value,
      embedding: params.embedding,
      expiresAt: params.ttl !== undefined ? Date.now() + params.ttl : undefined,
    });
  }

  private pruneExpired(ns: Map<string, StoredEntry>): void {
    const now = Date.now();
    for (const [key, entry] of ns) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        ns.delete(key);
      }
    }
  }

  async search(params: {
    namespace: string;
    query: string | number[];
    k?: number;
    minSimilarity?: number;
  }): Promise<Array<{ key: string; value: unknown; similarity: number }>> {
    const ns = this.storage.get(params.namespace);
    if (!ns) return [];

    // Empty query with no vector → return all with similarity 0 (for count queries)
    if (params.query === '' || (Array.isArray(params.query) && params.query.length === 0)) {
      const all = Array.from(ns.entries()).map(([key, { value }]) => ({
        key,
        value,
        similarity: 0,
      }));
      return all.slice(0, params.k ?? all.length);
    }

    const queryStr = typeof params.query === 'string' ? params.query.toLowerCase() : '';
    const minSim = params.minSimilarity ?? 0.6;
    const results: Array<{ key: string; value: unknown; similarity: number }> = [];

    for (const [key, { value, embedding }] of ns) {
      let similarity: number;

      if (Array.isArray(params.query) && embedding) {
        similarity = this.cosineSimilarity(params.query, embedding);
      } else if (queryStr) {
        const valueStr = JSON.stringify(value).toLowerCase();
        similarity = valueStr.includes(queryStr) ? 0.8 : 0.0;
      } else {
        similarity = 0;
      }

      if (similarity >= minSim) {
        results.push({ key, value, similarity });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, params.k ?? 10);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    let dot = 0,
      magA = 0,
      magB = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  async get(namespace: string, key: string): Promise<unknown | null> {
    return this.storage.get(namespace)?.get(key)?.value ?? null;
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.storage.get(namespace)?.delete(key);
  }
}
