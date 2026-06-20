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
        // Compute degree distributions from all symbol nodes in a single pass
        // (avoids two separate filter + map passes over potentially large arrays)
        const allFanIn = [];
        const allFanOut = [];
        for (const n of symbolNodes) {
            if (EXCLUDED_LABELS.has(n.label))
                continue;
            allFanIn.push(inDeg.get(n.id) ?? 0);
            allFanOut.push(outDeg.get(n.id) ?? 0);
        }
        allFanIn.sort((a, b) => a - b);
        allFanOut.sort((a, b) => a - b);
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
/**
 * Format god-node results as structured text with file:line hints for LLM navigation.
 */
export function formatGodNodes(output) {
    const { godNodes, thresholds } = output;
    if (godNodes.length === 0) {
        return 'god-nodes: none\nstatus: no high-centrality nodes detected\n';
    }
    const lines = [
        `god-nodes: ${godNodes.length} high-centrality node(s) detected`,
        `thresholds: fanIn p75=${thresholds.p75FanIn} p90=${thresholds.p90FanIn} p95=${thresholds.p95FanIn}; fanOut p75=${thresholds.p75FanOut} p90=${thresholds.p90FanOut}`,
        '',
    ];
    for (let i = 0; i < godNodes.length; i++) {
        const n = godNodes[i];
        const loc = n.filePath
            ? `${n.filePath}${n.startLine !== undefined ? `:${n.startLine}` : ''}`
            : n.id;
        lines.push(`[${i + 1}] ${n.name} (${n.label}) — ${n.category}`);
        lines.push(`  file: ${loc}`);
        lines.push(`  degree: ${n.degree} (fanIn=${n.inDegree}, fanOut=${n.outDegree})`);
        for (const f of n.contributingFactors) {
            lines.push(`  factor: ${f.metric}=${f.value} (threshold=${f.threshold})`);
        }
        lines.push('');
    }
    const bridgeCount = godNodes.filter(n => n.category === 'BRIDGE_NODE').length;
    const highCentralityCount = godNodes.length - bridgeCount;
    lines.push(`summary: ${highCentralityCount} HIGH_CENTRALITY, ${bridgeCount} BRIDGE_NODE`);
    return lines.join('\n');
}
//# sourceMappingURL=god-nodes.js.map