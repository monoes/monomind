/**
 * Group Sync
 *
 * Rebuilds the Contract Registry for a group by scanning each repo's
 * monograph database for Route nodes and finding cross-repo HTTP contracts.
 */
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import { parseGroupConfig } from './group-config.js';
import { extractHttpContracts, buildContractLinks, saveContractRegistry } from './contract-registry.js';
// ── Implementation ────────────────────────────────────────────────────────────
/**
 * Rebuild the contract registry for a group defined by a group.yaml file.
 *
 * For each repo in the group, opens its monograph database and extracts HTTP
 * contracts. Cross-repo links are identified and persisted to a SQLite
 * registry at `<group_config_dir>/.monograph-group/<groupName>.contracts.db`.
 *
 * Repos whose database does not exist are warned and skipped.
 *
 * @param configPath - Absolute path to the group.yaml file
 * @returns Summary of what was synced
 */
export async function syncGroup(configPath) {
    const config = parseGroupConfig(configPath);
    const allContracts = [];
    let reposScanned = 0;
    for (const repo of config.repos) {
        const dbPath = join(repo.path, '.monomind', 'monograph.db');
        if (!existsSync(dbPath)) {
            console.warn(`[group-sync] Skipping repo "${repo.name}": DB not found at ${dbPath}`);
            continue;
        }
        let db = null;
        try {
            db = new Database(dbPath, { readonly: true });
            const contracts = extractHttpContracts(db, repo.name);
            allContracts.push(...contracts);
            reposScanned++;
        }
        catch (err) {
            console.warn(`[group-sync] Error reading repo "${repo.name}": ${err}`);
        }
        finally {
            db?.close();
        }
    }
    const links = buildContractLinks(allContracts);
    const registryPath = join(dirname(configPath), '.monograph-group', `${config.name}.contracts.db`);
    saveContractRegistry(registryPath, links, allContracts);
    return {
        group: config.name,
        reposScanned,
        contractsFound: allContracts.length,
        crossRepoLinks: links.length,
        registryPath,
    };
}
//# sourceMappingURL=group-sync.js.map