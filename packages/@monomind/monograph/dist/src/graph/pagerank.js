const _stmtCache = new Map();
function getStmts(db) {
    const key = db.name ?? '__default__';
    let cache = _stmtCache.get(key);
    if (!cache) {
        cache = {
            selectNodes: db.prepare('SELECT id FROM nodes'),
            selectEdges: db.prepare('SELECT source_id, target_id FROM edges'),
        };
        _stmtCache.set(key, cache);
    }
    return cache;
}
// ---------------------------------------------------------------------------
// Result cache — avoids re-running power iteration when the graph hasn't
// changed. Keyed by (dbName, nodeCount, edgeCount) with a 5-second TTL.
// ---------------------------------------------------------------------------
const PAGERANK_CACHE_TTL_MS = 5_000;
const _resultCache = new Map();
function resultCacheKey(db, nodeCount, edgeCount) {
    const name = db.name ?? '__default__';
    return `${name}:${nodeCount}:${edgeCount}`;
}
/**
 * Evict cached statements and results for a given DB instance (call after writes).
 */
export function invalidatePageRankCache(db) {
    const key = db.name ?? '__default__';
    _stmtCache.delete(key);
    // Purge all result-cache entries for this DB (they have the name as prefix)
    for (const k of _resultCache.keys()) {
        if (k.startsWith(`${key}:`))
            _resultCache.delete(k);
    }
}
/**
 * Compute PageRank scores for all nodes using power iteration.
 *
 * Each node's score is initialized to 1/N (so scores sum to 1).
 * After convergence the scores still sum to ~1 (standard normalized PageRank).
 * Dangling nodes (out-degree 0) distribute their rank equally to all nodes.
 *
 * Results are cached for 5 seconds when the graph's node+edge counts are
 * unchanged, making repeated calls (e.g. during context preloading) free.
 *
 * @param db - The MonographDb instance
 * @param options - Optional tuning parameters
 * @returns Map of nodeId → PageRank score
 */
export function pageRank(db, options = {}) {
    const { dampingFactor = 0.85, maxIterations = 100, tolerance = 1e-6 } = options;
    const stmts = getStmts(db);
    const nodeRows = stmts.selectNodes.all();
    const edgeRows = stmts.selectEdges.all();
    if (nodeRows.length === 0)
        return new Map();
    // Check result cache before running power iteration
    const cacheKey = resultCacheKey(db, nodeRows.length, edgeRows.length);
    const now = Date.now();
    const cached = _resultCache.get(cacheKey);
    if (cached && now < cached.expiresAt)
        return cached.result;
    const nodes = nodeRows.map(r => r.id);
    const n = nodes.length;
    const nodeIndex = new Map();
    nodes.forEach((id, i) => nodeIndex.set(id, i));
    // Build adjacency: outEdges[i] = list of target indices
    const outEdges = nodes.map(() => []);
    const inEdges = nodes.map(() => []);
    for (const { source_id: src, target_id: tgt } of edgeRows) {
        if (src === tgt)
            continue;
        const si = nodeIndex.get(src);
        const ti = nodeIndex.get(tgt);
        if (si === undefined || ti === undefined)
            continue;
        outEdges[si].push(ti);
        inEdges[ti].push(si);
    }
    // Power iteration — initialize to uniform 1/N so scores sum to 1
    let scores = new Float64Array(n).fill(1 / n);
    const dangling1OverN = (1 - dampingFactor) / n;
    for (let iter = 0; iter < maxIterations; iter++) {
        const newScores = new Float64Array(n);
        // Collect dangling node contribution
        let danglingSum = 0;
        for (let i = 0; i < n; i++) {
            if (outEdges[i].length === 0)
                danglingSum += scores[i];
        }
        const danglingContrib = (dampingFactor * danglingSum) / n;
        for (let i = 0; i < n; i++) {
            let incoming = 0;
            for (const j of inEdges[i]) {
                incoming += scores[j] / outEdges[j].length;
            }
            newScores[i] = dangling1OverN + dampingFactor * incoming + danglingContrib;
        }
        // Check convergence
        let delta = 0;
        for (let i = 0; i < n; i++) {
            delta += Math.abs(newScores[i] - scores[i]);
        }
        scores = newScores;
        if (delta < tolerance)
            break;
    }
    const result = new Map();
    for (let i = 0; i < n; i++) {
        result.set(nodes[i], scores[i]);
    }
    // Store in result cache
    _resultCache.set(cacheKey, { result, expiresAt: now + PAGERANK_CACHE_TTL_MS });
    return result;
}
//# sourceMappingURL=pagerank.js.map