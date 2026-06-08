/**
 * MCP Tool backing for monograph_group_query
 *
 * Parses a group.yaml then runs a merged BM25 cross-repo search.
 */
import { type GroupResult } from '../groups/group-search.js';
/**
 * Run a group-wide query.
 *
 * @param groupConfigPath - Path to group.yaml (defaults to ./group.yaml)
 * @param query           - Search query string
 * @param limit           - Max results (default 20)
 */
export declare function runGroupQuery(groupConfigPath: string | undefined, query: string, limit?: number): Promise<GroupResult[]>;
//# sourceMappingURL=group-query.d.ts.map