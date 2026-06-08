/**
 * MCP Tool backing for monograph_group_sync
 *
 * Rebuilds the Contract Registry for a group: scans each repo for Route nodes,
 * finds cross-repo HTTP contracts, and persists the registry to disk.
 */
import { type GroupSyncResult } from '../groups/group-sync.js';
export type { GroupSyncResult };
/**
 * Run a group contract registry sync.
 *
 * @param configPath - Path to group.yaml (defaults to ./group.yaml in cwd)
 * @returns Summary of the sync operation
 * @throws {Error} If the config file is not found
 */
export declare function runGroupSync(configPath?: string): Promise<GroupSyncResult>;
//# sourceMappingURL=group-sync.d.ts.map