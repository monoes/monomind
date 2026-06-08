/**
 * Dependency health scoring.
 *
 * Produces a composite [0, 1] score by combining four sub-metrics:
 *
 *  1. Cycle penalty   — fraction of nodes involved in cycles (lower = worse)
 *  2. Dead-code ratio — fraction of nodes that are unreachable / unused
 *  3. Fan-out skew    — coefficient of variation of out-degrees (high skew = god nodes)
 *  4. God-node concentration — max in-degree / total edges (hub dominance)
 *
 * Final score = 1 − weighted average of penalties.
 * All individual penalty components are clamped to [0, 1].
 */
function stdDev(values) {
    if (values.length === 0)
        return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}
function clamp(x) {
    return Math.max(0, Math.min(1, x));
}
/**
 * Compute a composite dependency health score for the given graph.
 */
export function dependencyHealth(input) {
    const { nodes, edges, cycleCount, deadNodeCount } = input;
    const n = nodes.length;
    const m = edges.length;
    if (n === 0) {
        return {
            score: 1,
            details: { cyclePenalty: 0, deadCodeRatio: 0, fanSkew: 0, godNodeConcentration: 0 },
        };
    }
    // 1. Cycle penalty: cycleCount is the number of nodes in cycles (from topologicalLevelSort)
    //    Normalised by node count. Capped at 1.
    const cyclePenalty = clamp(cycleCount / n);
    // 2. Dead-code ratio
    const deadCodeRatio = clamp(deadNodeCount / n);
    // 3. Fan-out skew: coefficient of variation of out-degrees, normalised
    const outDegree = new Map(nodes.map(id => [id, 0]));
    for (const { sourceId } of edges) {
        outDegree.set(sourceId, (outDegree.get(sourceId) ?? 0) + 1);
    }
    const outValues = [...outDegree.values()];
    const outMean = outValues.reduce((a, b) => a + b, 0) / n;
    const cv = outMean > 0 ? stdDev(outValues) / outMean : 0;
    // CV > 2 → very skewed; normalise to [0,1] by clamping at 4
    const fanSkew = clamp(cv / 4);
    // 4. God-node concentration: max in-degree / total edges
    const inDegree = new Map(nodes.map(id => [id, 0]));
    for (const { targetId } of edges) {
        inDegree.set(targetId, (inDegree.get(targetId) ?? 0) + 1);
    }
    // Use reduce instead of spread to avoid RangeError on graphs with 65k+ nodes
    const maxInDeg = inDegree.size > 0
        ? [...inDegree.values()].reduce((a, b) => Math.max(a, b), 0)
        : 0;
    const godNodeConcentration = m > 0 ? clamp(maxInDeg / m) : 0;
    // Weighted composite penalty (weights sum to 1)
    const W_CYCLE = 0.35;
    const W_DEAD = 0.25;
    const W_FAN = 0.20;
    const W_GOD = 0.20;
    const penalty = W_CYCLE * cyclePenalty +
        W_DEAD * deadCodeRatio +
        W_FAN * fanSkew +
        W_GOD * godNodeConcentration;
    const score = clamp(1 - penalty);
    return {
        score,
        details: { cyclePenalty, deadCodeRatio, fanSkew, godNodeConcentration },
    };
}
//# sourceMappingURL=dependency-health.js.map