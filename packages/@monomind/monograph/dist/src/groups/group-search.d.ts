/**
 * Group Search
 *
 * Merged BM25 search across multiple repos using Reciprocal Rank Fusion (RRF).
 */
import type { GroupConfig } from './group-config.js';
export interface GroupResult {
    id: string;
    name: string;
    label: string;
    filePath: string | null;
    repo: string;
    score: number;
}
/**
 * Search across all repos in a group and merge results using RRF.
 *
 * @param groupConfig - Parsed group configuration
 * @param query       - Search query string
 * @param options     - Optional limit (default 20)
 * @returns Merged and re-ranked results
 */
export declare function groupQuery(groupConfig: GroupConfig, query: string, options?: {
    limit?: number;
}): Promise<GroupResult[]>;
//# sourceMappingURL=group-search.d.ts.map