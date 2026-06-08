/**
 * Contract Bridge Detection
 *
 * Finds shared type definitions (Interface, Type, Class) that appear across
 * multiple repos in a group — these are potential contract bridges.
 */
import { join } from 'path';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
function getRepoDbPath(repoPath) {
    return join(repoPath, '.monomind', 'monograph.db');
}
/**
 * Fetch all Interface, Type, and Class nodes from a repo DB.
 */
function fetchTypeNodes(dbPath, repoName) {
    if (!existsSync(dbPath)) {
        console.warn(`[contract-bridge] Skipping repo "${repoName}": DB not found at ${dbPath}`);
        return [];
    }
    let db = null;
    try {
        db = new Database(dbPath, { readonly: true });
        const rows = db
            .prepare(`SELECT name, label FROM nodes WHERE label IN ('Interface', 'Type', 'Class')`)
            .all();
        return rows;
    }
    catch (err) {
        console.warn(`[contract-bridge] Error reading repo "${repoName}": ${err}`);
        return [];
    }
    finally {
        db?.close();
    }
}
/**
 * Detect contract bridges: type names shared across >= 2 repos.
 * Results sorted by number of repos descending.
 *
 * @param groupConfig - Parsed group configuration
 * @returns List of ContractBridge entries
 */
export async function detectContractBridges(groupConfig) {
    // Map from type name -> { repos: Set<string>, labels: Set<string> }
    const typeMap = new Map();
    for (const repo of groupConfig.repos) {
        const dbPath = getRepoDbPath(repo.path);
        const rows = fetchTypeNodes(dbPath, repo.name);
        for (const row of rows) {
            if (!row.name)
                continue;
            const key = row.name;
            const existing = typeMap.get(key);
            if (existing) {
                existing.repos.add(repo.name);
                existing.labels.add(row.label);
            }
            else {
                typeMap.set(key, {
                    repos: new Set([repo.name]),
                    labels: new Set([row.label]),
                });
            }
        }
    }
    const bridges = [];
    for (const [name, { repos, labels }] of typeMap) {
        if (repos.size >= 2) {
            bridges.push({
                name,
                repos: [...repos],
                labels: [...labels],
            });
        }
    }
    // Sort by number of repos descending, then alphabetically
    bridges.sort((a, b) => b.repos.length - a.repos.length || a.name.localeCompare(b.name));
    return bridges;
}
//# sourceMappingURL=contract-bridge.js.map