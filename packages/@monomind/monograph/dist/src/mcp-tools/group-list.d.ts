/**
 * MCP Tool backing for monograph_group_list
 *
 * Returns metadata for each repo in a group: index timestamp and node count.
 */
export interface GroupRepoInfo {
    name: string;
    path: string;
    indexedAt: string | null;
    nodeCount: number;
}
export interface GroupListResult {
    groups: GroupInfo[];
}
export interface GroupInfo {
    name: string;
    repos: GroupRepoInfo[];
}
/**
 * Get list information for all repos in a group.
 *
 * @param configPath - Path to group.yaml (defaults to ./group.yaml)
 */
export declare function getGroupList(configPath?: string): Promise<GroupListResult>;
//# sourceMappingURL=group-list.d.ts.map