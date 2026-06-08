import type Database from 'better-sqlite3';
export interface ClusterOnlyResult {
    communityCount: number;
    nodeCount: number;
}
/**
 * Re-run community detection without re-extracting the full pipeline.
 * Reads edges from the DB, runs Leiden (Louvain-based) community detection,
 * and writes community_id assignments back to the nodes table.
 */
export declare function runClusterOnly(db: Database.Database): Promise<ClusterOnlyResult>;
//# sourceMappingURL=cluster-only.d.ts.map