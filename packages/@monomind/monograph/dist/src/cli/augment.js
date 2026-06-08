/**
 * augmentContext — Graph-RAG context augmentation
 *
 * Given a query string, retrieves the top-K relevant nodes from the
 * monograph knowledge graph using hybrid BM25+vector search (falls back
 * to BM25 when embeddings are unavailable) and returns a formatted
 * context block suitable for injection into an AI prompt.
 *
 * Usable from both CLI entry points and the monograph_augment MCP tool.
 */
import { join } from 'path';
import { openDb, closeDb } from '../storage/db.js';
import { hybridQuery } from '../search/hybrid-query.js';
import { globalAugmentCache } from '../cache/augment-cache.js';
/**
 * Retrieve the top-K relevant code nodes for a query and return a
 * formatted context string.
 */
export async function augmentContext(options) {
    const { query, repoPath, topK = 10, format = 'markdown' } = options;
    if (!query || query.trim().length === 0) {
        return format === 'json'
            ? JSON.stringify({ query, results: [], context: '' }, null, 2)
            : '';
    }
    if (topK === 0) {
        return format === 'json'
            ? JSON.stringify({ query, results: [], context: '' }, null, 2)
            : '';
    }
    const cacheKey = globalAugmentCache.makeKey(query, repoPath, topK, format);
    const cached = globalAugmentCache.get(cacheKey);
    if (cached !== undefined)
        return cached;
    const dbPath = join(repoPath, '.monomind', 'monograph.db');
    const db = openDb(dbPath);
    let results;
    try {
        results = await hybridQuery(db, query, { limit: topK });
    }
    finally {
        closeDb(db);
    }
    if (results.length === 0) {
        return format === 'json'
            ? JSON.stringify({ query, results: [], context: 'No relevant code context found.' }, null, 2)
            : 'No relevant code context found.';
    }
    if (format === 'json') {
        return JSON.stringify({
            query,
            results: results.map((r) => ({
                id: r.id,
                label: r.label ?? null,
                name: r.name ?? r.id,
                filePath: r.filePath ?? null,
                score: r.score,
            })),
        }, null, 2);
    }
    // Markdown format
    const lines = ['## Relevant Code Context', ''];
    for (const r of results) {
        const label = r.label ?? 'Symbol';
        const name = r.name ?? r.id;
        const location = r.filePath ? `${r.filePath}` : null;
        const heading = location ? `### ${label}: \`${name}\` (${location})` : `### ${label}: \`${name}\``;
        lines.push(heading);
        lines.push('');
    }
    const output = lines.join('\n').trimEnd();
    globalAugmentCache.set(cacheKey, output);
    return output;
}
//# sourceMappingURL=augment.js.map