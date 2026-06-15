import { createHash } from 'crypto';
import type { MonographDb } from './db.js';

export interface FileCacheEntry {
  filePath: string;
  contentHash: string;   // SHA-256 hex of file content (using node:crypto — xxh3 proxy)
  lastParsed: number;    // unix timestamp ms
  nodeCount: number;     // how many nodes were created from this file
  edgeCount: number;
}

export function hashFileContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function isFileCached(db: MonographDb, filePath: string, contentHash: string): boolean {
  const row = db.prepare(
    'SELECT content_hash FROM file_cache WHERE file_path = ?'
  ).get(filePath) as { content_hash: string } | undefined;
  return row?.content_hash === contentHash;
}

export function updateFileCache(db: MonographDb, entry: FileCacheEntry): void {
  db.prepare(`
    INSERT OR REPLACE INTO file_cache (file_path, content_hash, last_parsed, node_count, edge_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(entry.filePath, entry.contentHash, entry.lastParsed, entry.nodeCount, entry.edgeCount);
}

/**
 * Bulk-upsert multiple file cache entries in a single transaction.
 * Prefer this over calling updateFileCache in a loop for pipeline batch writes.
 */
export function batchUpdateFileCache(db: MonographDb, entries: FileCacheEntry[]): void {
  if (entries.length === 0) return;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO file_cache (file_path, content_hash, last_parsed, node_count, edge_count)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((rows: FileCacheEntry[]) => {
    for (const e of rows) {
      stmt.run(e.filePath, e.contentHash, e.lastParsed, e.nodeCount, e.edgeCount);
    }
  });
  insertMany(entries);
}

export function getFileCacheStats(db: MonographDb): {
  totalCached: number;
  hitRate: number;
  stalePaths: string[];
} {
  // Single query: count cached entries and distinct indexed file paths in one pass.
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM file_cache) AS total_cached,
      (SELECT COUNT(DISTINCT file_path) FROM nodes WHERE file_path IS NOT NULL) AS total_indexed
  `).get() as { total_cached: number; total_indexed: number };

  const totalCached = counts.total_cached;
  const hitRate = counts.total_indexed > 0 ? totalCached / counts.total_indexed : 0;

  // Find stale paths via SQL LEFT JOIN — avoids loading all rows into JS memory.
  const stalePaths = (db.prepare(`
    SELECT fc.file_path
    FROM file_cache fc
    LEFT JOIN (
      SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL
    ) n ON fc.file_path = n.file_path
    WHERE n.file_path IS NULL
  `).all() as { file_path: string }[]).map(r => r.file_path);

  return { totalCached, hitRate, stalePaths };
}

export function clearFileCache(db: MonographDb): void {
  db.prepare('DELETE FROM file_cache').run();
}
