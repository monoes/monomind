/**
 * MCP Tool backing for monograph_group_query
 *
 * Parses a group.yaml then runs a merged BM25 cross-repo search.
 */
import { join } from 'path';
import { parseGroupConfig } from '../groups/group-config.js';
import { groupQuery } from '../groups/group-search.js';
/**
 * Run a group-wide query.
 *
 * @param groupConfigPath - Path to group.yaml (defaults to ./group.yaml)
 * @param query           - Search query string
 * @param limit           - Max results (default 20)
 */
export async function runGroupQuery(groupConfigPath, query, limit) {
    const configPath = groupConfigPath ?? join(process.cwd(), 'group.yaml');
    const config = parseGroupConfig(configPath);
    return groupQuery(config, query, { limit: limit ?? 20 });
}
//# sourceMappingURL=group-query.js.map