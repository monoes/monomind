/**
 * Group Search
 *
 * Merged BM25 search across multiple repos using Reciprocal Rank Fusion (RRF).
 */
import { join } from 'path';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
/**
 * Determine the monograph DB path for a given repo root.
 * Mirrors the convention used in monograph-tools.ts: <repoPath>/.monomind/monograph.db
 */
function getRepoDbPath(repoPath) {
    return join(repoPath, '.monomind', 'monograph.db');
}
/**
 * Run BM25 FTS5 search against a single repo DB.
 * Returns raw rows tagged with the repo name.
 */
function searchRepo(dbPath, repoName, query, perRepoLimit) {
    if (!existsSync(dbPath)) {
        console.warn(`[group-search] Skipping repo "${repoName}": DB not found at ${dbPath}`);
        return [];
    }
    let db = null;
    try {
        db = new Database(dbPath, { readonly: true });
        // Sanitize and build prefix query
        const safeQuery = query.replace(/['"*]/g, ' ').trim();
        if (!safeQuery)
            return [];
        const ftsPrefixQuery = safeQuery
            .split(/\s+/)
            .map((t) => t + '*')
            .join(' ');
        const sql = `
      SELECT n.id, n.name, n.label, n.file_path
      FROM nodes_fts
      JOIN nodes n ON n.rowid = nodes_fts.rowid
      WHERE nodes_fts MATCH ?
      ORDER BY nodes_fts.rank
      LIMIT ?
    `;
        const rows = db.prepare(sql).all(ftsPrefixQuery, perRepoLimit);
        return rows.map((r, idx) => ({
            id: `${repoName}::${r.id}`,
            name: r.name,
            label: r.label,
            filePath: r.file_path ?? null,
            repo: repoName,
            // Use rank position as initial score so RRF can compute correctly
            score: 1 / (60 + idx + 1),
        }));
    }
    catch (err) {
        console.warn(`[group-search] Error searching repo "${repoName}": ${err}`);
        return [];
    }
    finally {
        db?.close();
    }
}
/**
 * Search across all repos in a group and merge results using RRF.
 *
 * @param groupConfig - Parsed group configuration
 * @param query       - Search query string
 * @param options     - Optional limit (default 20)
 * @returns Merged and re-ranked results
 */
export async function groupQuery(groupConfig, query, options) {
    const limit = options?.limit ?? 20;
    const perRepoLimit = 50;
    // Collect results from each repo
    const repoResults = [];
    for (const repo of groupConfig.repos) {
        const dbPath = getRepoDbPath(repo.path);
        const results = searchRepo(dbPath, repo.name, query, perRepoLimit);
        if (results.length > 0) {
            repoResults.push(results);
        }
    }
    if (repoResults.length === 0)
        return [];
    const scoreMap = new Map();
    for (const results of repoResults) {
        for (let idx = 0; idx < results.length; idx++) {
            const item = results[idx];
            const contribution = 1 / (60 + idx + 1);
            const existing = scoreMap.get(item.id);
            if (existing) {
                existing.rrf += contribution;
            }
            else {
                scoreMap.set(item.id, { rrf: contribution, payload: item });
            }
        }
    }
    const merged = [...scoreMap.values()]
        .sort((a, b) => b.rrf - a.rrf)
        .map(({ rrf, payload }) => ({ ...payload, score: rrf }));
    // Build final output, preserving repo metadata from merged payload
    return merged.slice(0, limit).map((r) => ({
        id: r.id,
        name: r.name ?? '',
        label: r.label ?? '',
        filePath: r.filePath ?? null,
        repo: r.repo ?? '',
        score: r.score,
    }));
}
//# sourceMappingURL=group-search.js.map