// Top-level container that bundles every health-pipeline output into a
// single serializable object for LSP, CI, and dashboard consumers.
export function createHealthReport(summary, partials = {}) {
    const report = { summary };
    for (const [key, value] of Object.entries(partials)) {
        if (value !== undefined && value !== null) {
            report[key] = value;
        }
    }
    return report;
}
export function createHealthReportSummary(healthScore, totalFiles, totalLoc, coverageModel = 'none') {
    // Use canonical thresholds from health-report-types.ts (A≥90, B≥75, C≥60, D≥40)
    const grade = healthScore >= 90 ? 'A' :
        healthScore >= 75 ? 'B' :
            healthScore >= 60 ? 'C' :
                healthScore >= 40 ? 'D' : 'F';
    return {
        healthScore,
        healthGrade: grade,
        totalFiles,
        totalLoc,
        issueCount: 0,
        coverageModel,
        generatedAt: new Date().toISOString(),
    };
}
export function formatHealthReportSummary(s) {
    return [
        `Health: ${s.healthGrade} (${s.healthScore.toFixed(1)}/100)`,
        `Files: ${s.totalFiles}  LOC: ${s.totalLoc}`,
        `Coverage model: ${s.coverageModel}`,
        `Generated: ${s.generatedAt}`,
    ].join('\n');
}
export function healthReportToJson(report) {
    return JSON.stringify(report, null, 2);
}
//# sourceMappingURL=health-report.js.map