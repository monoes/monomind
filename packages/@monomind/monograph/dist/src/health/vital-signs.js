// Extended vital-signs metric struct for project-wide trend tracking.
// Extends the basic snapshot with interfacing risk, LOC, coverage model, coupling.
export const VITAL_SIGNS_SCHEMA_VERSION = 7;
export function createVitalSigns(partial) {
    const now = new Date().toISOString();
    return {
        schemaVersion: VITAL_SIGNS_SCHEMA_VERSION,
        createdAt: now,
        healthScore: 0,
        healthGrade: 'F',
        counts: {
            unusedExports: 0, deadFiles: 0, circularDeps: 0, boundaryViolations: 0,
            cloneGroups: 0, duplicatedLinesPct: 0, highComplexityFunctions: 0,
        },
        sizeRisk: { smallPct: 0, mediumPct: 0, largePct: 0, xlargePct: 0 },
        interfacingRisk: { lowParamPct: 0, mediumParamPct: 0, highParamPct: 0, xlParamPct: 0 },
        fanIn95th: 0,
        couplingConcentrationPct: 0,
        totalLoc: 0,
        totalFiles: 0,
        totalNodes: 0,
        totalEdges: 0,
        coverageModel: 'none',
        ...partial,
    };
}
export function formatVitalSignsSummary(vs) {
    return [
        `Health: ${vs.healthGrade} (${vs.healthScore.toFixed(1)}/100)`,
        `Files: ${vs.totalFiles}  LOC: ${vs.totalLoc}  Nodes: ${vs.totalNodes}`,
        `Unused exports: ${vs.counts.unusedExports}  Dead files: ${vs.counts.deadFiles}`,
        `Duplication: ${vs.counts.duplicatedLinesPct.toFixed(1)}%  Clones: ${vs.counts.cloneGroups}`,
        `Circular deps: ${vs.counts.circularDeps}  Boundary violations: ${vs.counts.boundaryViolations}`,
        `Coverage model: ${vs.coverageModel}`,
    ].join('\n');
}
//# sourceMappingURL=vital-signs.js.map