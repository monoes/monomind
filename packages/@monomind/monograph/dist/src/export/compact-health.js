import { relative } from 'node:path';
function rel(p, root) { return relative(root, p); }
export function buildHealthCompactLines(report) {
    const lines = [];
    const { root } = report;
    if (report.healthScore)
        lines.push(`health-score:${report.healthScore.score.toFixed(1)}:${report.healthScore.grade}`);
    if (report.vitalSigns) {
        const vs = report.vitalSigns;
        const parts = [];
        if (vs.totalLoc)
            parts.push(`total_loc=${vs.totalLoc}`);
        parts.push(`avg_cyclomatic=${vs.avgCyclomatic.toFixed(1)}`);
        parts.push(`p90_cyclomatic=${vs.p90Cyclomatic}`);
        if (vs.deadFilePct !== undefined)
            parts.push(`dead_file_pct=${vs.deadFilePct.toFixed(1)}`);
        if (vs.deadExportPct !== undefined)
            parts.push(`dead_export_pct=${vs.deadExportPct.toFixed(1)}`);
        if (vs.maintainabilityAvg !== undefined)
            parts.push(`maintainability_avg=${vs.maintainabilityAvg.toFixed(1)}`);
        if (vs.hotspotCount !== undefined)
            parts.push(`hotspot_count=${vs.hotspotCount}`);
        if (vs.circularDepCount !== undefined)
            parts.push(`circular_dep_count=${vs.circularDepCount}`);
        if (vs.unusedDepCount !== undefined)
            parts.push(`unused_dep_count=${vs.unusedDepCount}`);
        lines.push(`vital-signs:${parts.join(',')}`);
    }
    for (const f of report.findings ?? []) {
        const crapSuffix = f.crap !== undefined
            ? `,crap=${f.crap.toFixed(1)}${f.coveragePct !== undefined ? `,coverage_pct=${f.coveragePct.toFixed(1)}` : ''}` : '';
        lines.push(`high-complexity:${rel(f.path, root)}:${f.line}:${f.name}:cyclomatic=${f.cyclomatic},cognitive=${f.cognitive},severity=${f.severity}${crapSuffix}`);
    }
    for (const h of report.hotspots ?? []) {
        lines.push(`hotspot:${rel(h.path, root)}:score=${h.score.toFixed(1)},commits=${h.commits},churn=${h.linesAdded + h.linesDeleted},density=${h.complexityDensity.toFixed(2)},fan_in=${h.fanIn},trend=${h.trend}`);
    }
    if (report.healthTrend) {
        lines.push(`trend:overall:direction=${report.healthTrend.overallDirection}`);
        for (const m of report.healthTrend.metrics) {
            const sign = m.delta >= 0 ? '+' : '';
            lines.push(`trend:${m.name}:previous=${m.previous.toFixed(1)},current=${m.current.toFixed(1)},delta=${sign}${m.delta.toFixed(1)},direction=${m.direction}`);
        }
    }
    return lines;
}
export function buildDuplicationCompactLines(report) {
    const lines = [];
    const { root } = report;
    for (let i = 0; i < report.cloneGroups.length; i++) {
        const group = report.cloneGroups[i];
        for (const inst of group.instances) {
            const tokens = inst.tokenCount !== undefined ? `${inst.tokenCount}tokens` : '';
            lines.push(`clone-group-${i + 1}:${rel(inst.file, root)}:${inst.startLine}-${inst.endLine}${tokens ? ':' + tokens : ''}`);
        }
    }
    return lines;
}
//# sourceMappingURL=compact-health.js.map