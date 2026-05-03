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

export function getFileCacheStats(db: MonographDb): {
  totalCached: number;
  hitRate: number;
  stalePaths: string[];
} {
  const totalCached = (db.prepare('SELECT COUNT(*) as c FROM file_cache').get() as { c: number }).c;

  const totalNodes = (db.prepare(
    "SELECT COUNT(DISTINCT file_path) as c FROM nodes WHERE file_path IS NOT NULL"
  ).get() as { c: number }).c;

  const hitRate = totalNodes > 0 ? totalCached / totalNodes : 0;

  // Find stale paths: cached entries whose file no longer exists in nodes table
  const cachedPaths = db.prepare('SELECT file_path, content_hash FROM file_cache').all() as {
    file_path: string;
    content_hash: string;
  }[];

  const indexedPaths = new Set<string>(
    (db.prepare("SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL").all() as {
      file_path: string;
    }[]).map(r => r.file_path)
  );

  const stalePaths = cachedPaths
    .filter(r => !indexedPaths.has(r.file_path))
    .map(r => r.file_path);

  return { totalCached, hitRate, stalePaths };
}

export function clearFileCache(db: MonographDb): void {
  db.prepare('DELETE FROM file_cache').run();
}
