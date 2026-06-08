/**
 * Group Sync
 *
 * Rebuilds the Contract Registry for a group by scanning each repo's
 * monograph database for Route nodes and finding cross-repo HTTP contracts.
 */
export interface GroupSyncResult {
    group: string;
    reposScanned: number;
    contractsFound: number;
    crossRepoLinks: number;
    registryPath: string;
}
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
export declare function syncGroup(configPath: string): Promise<GroupSyncResult>;
//# sourceMappingURL=group-sync.d.ts.map