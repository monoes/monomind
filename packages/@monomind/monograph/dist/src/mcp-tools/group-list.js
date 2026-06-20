/**
 * MCP Tool backing for monograph_group_list
 *
 * Returns metadata for each repo in a group: index timestamp and node count.
 */
import { join } from 'path';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import { parseGroupConfig } from '../groups/group-config.js';
function getRepoDbPath(repoPath) {
    return join(repoPath, '.monomind', 'monograph.db');
}
function readRepoStats(repoPath) {
    const dbPath = getRepoDbPath(repoPath);
    if (!existsSync(dbPath)) {
        return { indexedAt: null, nodeCount: 0, error: 'index not found' };
    }
    let db = null;
    try {
        db = new Database(dbPath, { readonly: true });
        const metaRow = db
            .prepare(`SELECT value FROM index_meta WHERE key = 'indexed_at'`)
            .get();
        const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM nodes`).get();
        return { indexedAt: metaRow?.value ?? null, nodeCount: countRow.cnt };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { indexedAt: null, nodeCount: 0, error: message };
    }
    finally {
        db?.close();
    }
}
/**
 * Get list information for all repos in a group.
 *
 * @param configPath - Path to group.yaml (defaults to ./group.yaml)
 */
export async function getGroupList(configPath) {
    const resolvedPath = configPath ?? join(process.cwd(), 'group.yaml');
    const config = parseGroupConfig(resolvedPath);
    const repos = config.repos.map((repo) => {
        const { indexedAt, nodeCount, error } = readRepoStats(repo.path);
        return {
            name: repo.name,
            path: repo.path,
            indexedAt,
            nodeCount,
            ...(error ? { error } : {}),
        };
    });
    return {
        groups: [
            {
                name: config.name,
                repos,
            },
        ],
    };
}
//# sourceMappingURL=group-list.js.map