/**
 * Monograph compatibility shim — @monoes/monograph@1.2.0
 *
 * Only getGroupContracts and getGroupStatus are kept here because they are not
 * exported by the published @monoes/monograph@1.2.0. Everything else has been
 * moved to the real package.
 */
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { openDb, closeDb, countNodes } from '@monoes/monograph';
function readGroupConfig(configPath) {
    if (!existsSync(configPath))
        return [];
    try {
        const raw = readFileSync(configPath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return [];
    }
}
// ── getGroupContracts ─────────────────────────────────────────────────────────
export async function getGroupContracts(configPath) {
    const repos = readGroupConfig(configPath);
    const result = [];
    for (const repo of repos) {
        const repoPath = repo.path ?? '';
        const dbPath = join(repoPath, '.monomind', 'monograph.db');
        if (!existsSync(dbPath))
            continue;
        try {
            const db = openDb(dbPath);
            const exported = db.prepare("SELECT * FROM nodes WHERE is_exported = 1 AND label NOT IN ('File','Folder','Community','Concept') LIMIT 100").all();
            closeDb(db);
            for (const n of exported) {
                result.push({
                    groupName: repo.name ?? repoPath,
                    symbol: n.name,
                    filePath: n.file_path ?? null,
                    line: n.start_line ?? null,
                });
            }
        }
        catch { /* skip */ }
    }
    return result;
}
// ── getGroupStatus ────────────────────────────────────────────────────────────
export async function getGroupStatus(configPath) {
    const repos = readGroupConfig(configPath);
    if (repos.length === 0) {
        return { totalGroups: 0, indexedGroups: 0, stalledGroups: 0, groups: [] };
    }
    const groups = [];
    for (const repo of repos) {
        const repoPath = repo.path ?? '';
        const dbPath = join(repoPath, '.monomind', 'monograph.db');
        const name = repo.name ?? repoPath;
        if (!existsSync(dbPath)) {
            groups.push({ name, indexed: false, stale: false, contractCount: 0 });
            continue;
        }
        try {
            const db = openDb(dbPath);
            const nc = countNodes(db);
            const contracts = db.prepare("SELECT COUNT(*) as n FROM nodes WHERE label = 'Route'").get();
            const meta = db.prepare("SELECT value FROM index_meta WHERE key IN ('ua_last_commit','lastCommit') LIMIT 1").get();
            closeDb(db);
            groups.push({
                name,
                indexed: nc > 0,
                stale: false,
                contractCount: contracts?.n ?? 0,
                ...(meta?.value ? { lastSync: meta.value } : {}),
            });
        }
        catch {
            groups.push({ name, indexed: false, stale: false, contractCount: 0 });
        }
    }
    const indexedGroups = groups.filter(g => g.indexed).length;
    const stalledGroups = groups.filter(g => g.stale).length;
    return { totalGroups: groups.length, indexedGroups, stalledGroups, groups };
}
//# sourceMappingURL=monograph-compat.js.map