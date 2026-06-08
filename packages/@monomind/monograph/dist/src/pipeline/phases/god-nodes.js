const EXCLUDED_LABELS = new Set(['File', 'Folder', 'Community', 'Concept']);
function percentile(sorted, p) {
    if (sorted.length === 0)
        return 0;
    const idx = Math.floor((p / 100) * sorted.length);
    return sorted[Math.min(idx, sorted.length - 1)];
}
export const godNodesPhase = {
    name: 'god-nodes',
    deps: ['cross-file', 'parse'],
    async execute(ctx, deps) {
        const { resolvedEdges } = deps.get('cross-file');
        const { allEdges, symbolNodes } = deps.get('parse');
        const allEdgesCombined = [...allEdges, ...resolvedEdges];
        const inDeg = new Map();
        const outDeg = new Map();
        for (const e of allEdgesCombined) {
            outDeg.set(e.sourceId, (outDeg.get(e.sourceId) ?? 0) + 1);
            inDeg.set(e.targetId, (inDeg.get(e.targetId) ?? 0) + 1);
        }
        // Compute degree distributions from all symbol nodes
        const allFanIn = symbolNodes
            .filter(n => !EXCLUDED_LABELS.has(n.label))
            .map(n => inDeg.get(n.id) ?? 0)
            .sort((a, b) => a - b);
        const allFanOut = symbolNodes
            .filter(n => !EXCLUDED_LABELS.has(n.label))
            .map(n => outDeg.get(n.id) ?? 0)
            .sort((a, b) => a - b);
        const thresholds = {
            p75FanIn: percentile(allFanIn, 75),
            p90FanIn: percentile(allFanIn, 90),
            p95FanIn: percentile(allFanIn, 95),
            p75FanOut: percentile(allFanOut, 75),
            p90FanOut: percentile(allFanOut, 90),
        };
        const p95FanIn = thresholds.p95FanIn;
        const p75FanIn = thresholds.p75FanIn;
        const p75FanOut = thresholds.p75FanOut;
        const godNodes = symbolNodes
            .filter(n => !EXCLUDED_LABELS.has(n.label) && (inDeg.get(n.id) ?? 0) + (outDeg.get(n.id) ?? 0) > p95FanIn)
            .map(n => {
            const fanIn = inDeg.get(n.id) ?? 0;
            const fanOut = outDeg.get(n.id) ?? 0;
            const degree = fanIn + fanOut;
            const contributingFactors = [];
            if (fanIn > p95FanIn) {
                contributingFactors.push({ metric: 'fanIn', value: fanIn, threshold: p95FanIn });
            }
            if (fanIn > p75FanIn) {
                contributingFactors.push({ metric: 'fanInP75', value: fanIn, threshold: p75FanIn });
            }
            if (fanOut > p75FanOut) {
                contributingFactors.push({ metric: 'fanOut', value: fanOut, threshold: p75FanOut });
            }
            let category;
            if (fanIn > p95FanIn && fanOut > p75FanOut) {
                category = 'BRIDGE_NODE';
            }
            else {
                category = 'HIGH_CENTRALITY';
            }
            return {
                ...n,
                inDegree: fanIn,
                outDegree: fanOut,
                degree,
                category,
                contributingFactors,
            };
        })
            .sort((a, b) => b.degree - a.degree)
            .slice(0, 20);
        return { godNodes, thresholds };
    },
};
//# sourceMappingURL=god-nodes.js.map