// Extended runtime coverage report model with confidence scoring,
// multi-source evidence, hot-path tracking, and blast-radius analysis.
export function buildRuntimeCoverageSummary(findings) {
    const counts = { hotPath: 0, warm: 0, cold: 0, unknown: 0 };
    let totalPct = 0;
    let pctCount = 0;
    let dataSource = 'none';
    for (const f of findings) {
        counts[f.watermark]++;
        if (f.evidence.coveragePct !== null) {
            totalPct += f.evidence.coveragePct;
            pctCount++;
        }
        if (f.quality.dataSource !== 'none')
            dataSource = f.quality.dataSource;
    }
    return {
        totalFiles: findings.length,
        hotPathFiles: counts.hotPath,
        warmFiles: counts.warm,
        coldFiles: counts.cold,
        unknownFiles: counts.unknown,
        averageCoveragePct: pctCount > 0 ? totalPct / pctCount : null,
        dataSource,
    };
}
export function createRuntimeCoverageReport(findings) {
    return {
        findings,
        summary: buildRuntimeCoverageSummary(findings),
        generatedAt: new Date().toISOString(),
    };
}
//# sourceMappingURL=runtime-coverage-report.js.map