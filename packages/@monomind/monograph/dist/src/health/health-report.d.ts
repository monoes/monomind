export interface HealthReportSummary {
    healthScore: number;
    healthGrade: 'A' | 'B' | 'C' | 'D' | 'F';
    totalFiles: number;
    totalLoc: number;
    issueCount: number;
    coverageModel: string;
    generatedAt: string;
}
export interface HealthReport {
    summary: HealthReportSummary;
    findings?: unknown[];
    fileScores?: unknown[];
    coverageGaps?: unknown;
    hotspots?: unknown[];
    hotspotSummary?: unknown;
    runtimeCoverage?: unknown;
    largeFunctions?: unknown[];
    targets?: unknown[];
    targetThresholds?: unknown;
    healthTrend?: unknown;
    vitalSigns?: unknown;
    distributionThresholds?: unknown;
    analysisCounts?: unknown;
    timings?: unknown;
}
export declare function createHealthReport(summary: HealthReportSummary, partials?: Omit<HealthReport, 'summary'>): HealthReport;
export declare function createHealthReportSummary(healthScore: number, totalFiles: number, totalLoc: number, coverageModel?: string): HealthReportSummary;
export declare function formatHealthReportSummary(s: HealthReportSummary): string;
export declare function healthReportToJson(report: HealthReport): string;
//# sourceMappingURL=health-report.d.ts.map