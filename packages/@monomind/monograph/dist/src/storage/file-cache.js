import { createHash } from 'crypto';
export function hashFileContent(content) {
    return createHash('sha256').update(content).digest('hex');
}
export function isFileCached(db, filePath, contentHash) {
    const row = db.prepare('SELECT content_hash FROM file_cache WHERE file_path = ?').get(filePath);
    return row?.content_hash === contentHash;
}
export function updateFileCache(db, entry) {
    db.prepare(`
    INSERT OR REPLACE INTO file_cache (file_path, content_hash, last_parsed, node_count, edge_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(entry.filePath, entry.contentHash, entry.lastParsed, entry.nodeCount, entry.edgeCount);
}
/**
 * Bulk-upsert multiple file cache entries in a single transaction.
 * Prefer this over calling updateFileCache in a loop for pipeline batch writes.
 */
export function batchUpdateFileCache(db, entries) {
    if (entries.length === 0)
        return;
    const stmt = db.prepare(`
    INSERT OR REPLACE INTO file_cache (file_path, content_hash, last_parsed, node_count, edge_count)
    VALUES (?, ?, ?, ?, ?)
  `);
    const insertMany = db.transaction((rows) => {
        for (const e of rows) {
            stmt.run(e.filePath, e.contentHash, e.lastParsed, e.nodeCount, e.edgeCount);
        }
    });
    insertMany(entries);
}
export function getFileCacheStats(db) {
    // Single query: count cached entries and distinct indexed file paths in one pass.
    const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM file_cache) AS total_cached,
      (SELECT COUNT(DISTINCT file_path) FROM nodes WHERE file_path IS NOT NULL) AS total_indexed
  `).get();
    const totalCached = counts.total_cached;
    const hitRate = counts.total_indexed > 0 ? totalCached / counts.total_indexed : 0;
    // Find stale paths via SQL LEFT JOIN — avoids loading all rows into JS memory.
    const stalePaths = db.prepare(`
    SELECT fc.file_path
    FROM file_cache fc
    LEFT JOIN (
      SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL
    ) n ON fc.file_path = n.file_path
    WHERE n.file_path IS NULL
  `).all().map(r => r.file_path);
    return { totalCached, hitRate, stalePaths };
}
export function clearFileCache(db) {
    db.prepare('DELETE FROM file_cache').run();
}
//# sourceMappingURL=file-cache.js.map