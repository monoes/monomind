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
export function getFileCacheStats(db) {
    const totalCached = db.prepare('SELECT COUNT(*) as c FROM file_cache').get().c;
    const totalNodes = db.prepare("SELECT COUNT(DISTINCT file_path) as c FROM nodes WHERE file_path IS NOT NULL").get().c;
    const hitRate = totalNodes > 0 ? totalCached / totalNodes : 0;
    // Find stale paths: cached entries whose file no longer exists in nodes table
    const cachedPaths = db.prepare('SELECT file_path, content_hash FROM file_cache').all();
    const indexedPaths = new Set(db.prepare("SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL").all().map(r => r.file_path));
    const stalePaths = cachedPaths
        .filter(r => !indexedPaths.has(r.file_path))
        .map(r => r.file_path);
    return { totalCached, hitRate, stalePaths };
}
export function clearFileCache(db) {
    db.prepare('DELETE FROM file_cache').run();
}
//# sourceMappingURL=file-cache.js.map