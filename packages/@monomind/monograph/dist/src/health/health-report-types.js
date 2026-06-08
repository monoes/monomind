export const HOTSPOT_SCORE_THRESHOLD = 50.0;
export function letterGrade(score) {
    if (score >= 90)
        return 'A';
    if (score >= 75)
        return 'B';
    if (score >= 60)
        return 'C';
    if (score >= 40)
        return 'D';
    return 'F';
}
export function makeHealthScore(score, penalties = {}) {
    return {
        score: Math.max(0, Math.min(100, score)),
        grade: letterGrade(score),
        penalties: {
            complexity: penalties.complexity ?? 0,
            duplication: penalties.duplication ?? 0,
            deadCode: penalties.deadCode ?? 0,
            coupling: penalties.coupling ?? 0,
            maintainability: penalties.maintainability ?? 0,
        },
    };
}
export function computeVitalSigns(partial) {
    return {
        deadFilePct: partial.deadFilePct ?? 0,
        deadExportPct: partial.deadExportPct ?? 0,
        avgCyclomatic: partial.avgCyclomatic ?? 0,
        p90Cyclomatic: partial.p90Cyclomatic ?? 0,
        duplicationPct: partial.duplicationPct ?? 0,
        hotspotCount: partial.hotspotCount ?? 0,
        maintainabilityAvg: partial.maintainabilityAvg ?? 100,
        unusedDepCount: partial.unusedDepCount ?? 0,
        circularDepCount: partial.circularDepCount ?? 0,
        counts: partial.counts ?? { unusedFiles: 0, unusedExports: 0, unusedTypes: 0, privateTypeLeaks: 0, unusedDependencies: 0, unresolvedImports: 0, circularDependencies: 0, boundaryViolations: 0 },
        unitSizeProfile: partial.unitSizeProfile ?? { tiny: 0, small: 0, medium: 0, large: 0, huge: 0 },
        couplingHighPct: partial.couplingHighPct ?? 0,
    };
}
export function formatVitalSigns(vs) {
    return [
        `Dead files:        ${vs.counts.unusedFiles} (${vs.deadFilePct.toFixed(1)}%)`,
        `Dead exports:      ${vs.counts.unusedExports} (${vs.deadExportPct.toFixed(1)}%)`,
        `Avg cyclomatic:    ${vs.avgCyclomatic.toFixed(1)} (p90: ${vs.p90Cyclomatic.toFixed(1)})`,
        `Duplication:       ${vs.duplicationPct.toFixed(1)}%`,
        `Hotspots:          ${vs.hotspotCount}`,
        `Maintainability:   ${vs.maintainabilityAvg.toFixed(1)}/100`,
        `Unused deps:       ${vs.unusedDepCount}`,
        `Circular deps:     ${vs.circularDepCount}`,
        `High coupling:     ${vs.couplingHighPct.toFixed(1)}%`,
    ];
}
//# sourceMappingURL=health-report-types.js.map