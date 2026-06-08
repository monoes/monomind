import { loadGraphFromDb } from '../graph/loader.js';
import { leiden } from './phases/leiden.js';
import louvain from 'graphology-communities-louvain';
/**
 * Re-run community detection without re-extracting the full pipeline.
 * Reads edges from the DB, runs Leiden (Louvain-based) community detection,
 * and writes community_id assignments back to the nodes table.
 */
export async function runClusterOnly(db) {
    // Check if there are any edges at all
    const edgeCount = db.prepare('SELECT COUNT(*) as cnt FROM edges').get().cnt;
    if (edgeCount === 0) {
        return { communityCount: 0, nodeCount: 0 };
    }
    // Build graphology graph from the DB
    const graph = loadGraphFromDb(db);
    if (graph.order === 0) {
        return { communityCount: 0, nodeCount: 0 };
    }
    // Run community detection using Leiden (Louvain-based with refinement)
    let communities = {};
    try {
        communities = leiden(graph, { seed: 42 });
    }
    catch (e) {
        console.warn('[monograph] Leiden failed in cluster-only, falling back to Louvain:', e);
        try {
            communities = louvain(graph, { randomWalk: false });
        }
        catch {
            // Assign all to community 0 as last resort
            for (const nodeId of graph.nodes()) {
                communities[nodeId] = 0;
            }
        }
    }
    // Write community assignments back to DB
    const updateStmt = db.prepare('UPDATE nodes SET community_id = ? WHERE id = ?');
    const updateAll = db.transaction(() => {
        for (const [nodeId, commId] of Object.entries(communities)) {
            updateStmt.run(commId, nodeId);
        }
    });
    updateAll();
    const communityIds = new Set(Object.values(communities));
    return {
        communityCount: communityIds.size,
        nodeCount: Object.keys(communities).length,
    };
}
//# sourceMappingURL=cluster-only.js.map