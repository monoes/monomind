// Top-level container that bundles every health-pipeline output into a
// single serializable object for LSP, CI, and dashboard consumers.

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

  // Core analysis outputs (all optional — skipped-when-absent for partial runs)
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

export function createHealthReport(
  summary: HealthReportSummary,
  partials: Omit<HealthReport, 'summary'> = {},
): HealthReport {
  const report: HealthReport = { summary };
  for (const [key, value] of Object.entries(partials) as [keyof Omit<HealthReport, 'summary'>, unknown][]) {
    if (value !== undefined && value !== null) {
      (report as Record<string, unknown>)[key] = value;
    }
  }
  return report;
}

export function createHealthReportSummary(
  healthScore: number,
  totalFiles: number,
  totalLoc: number,
  coverageModel = 'none',
): HealthReportSummary {
  const grade =
    healthScore >= 90 ? 'A' :
    healthScore >= 80 ? 'B' :
    healthScore >= 65 ? 'C' :
    healthScore >= 50 ? 'D' : 'F';
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

export function formatHealthReportSummary(s: HealthReportSummary): string {
  return [
    `Health: ${s.healthGrade} (${s.healthScore.toFixed(1)}/100)`,
    `Files: ${s.totalFiles}  LOC: ${s.totalLoc}`,
    `Coverage model: ${s.coverageModel}`,
    `Generated: ${s.generatedAt}`,
  ].join('\n');
}

export function healthReportToJson(report: HealthReport): string {
  return JSON.stringify(report, null, 2);
}
