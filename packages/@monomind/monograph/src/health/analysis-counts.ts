// Lightweight aggregate counts computed from analysis results,
// fed into VitalSignsInput for percentage-based metric derivation.

export interface AnalysisCounts {
  totalExports: number;
  deadFiles: number;
  deadExports: number;
  unusedDeps: number;
  circularDeps: number;
  totalDeps: number;
  duplicateExports: number;
  boundaryViolations: number;
}

export const ZERO_ANALYSIS_COUNTS: AnalysisCounts = {
  totalExports: 0,
  deadFiles: 0,
  deadExports: 0,
  unusedDeps: 0,
  circularDeps: 0,
  totalDeps: 0,
  duplicateExports: 0,
  boundaryViolations: 0,
};

export interface AnalysisResultsInput {
  unusedExports?: unknown[];
  deadFiles?: unknown[];
  unusedDependencies?: unknown[];
  circularDependencies?: unknown[];
  allDependencies?: unknown[];
  duplicateExports?: unknown[];
  boundaryViolations?: unknown[];
}

/** Compute aggregate counts from analysis results (all fields optional). */
export function computeAnalysisCounts(results: AnalysisResultsInput): AnalysisCounts {
  return {
    totalExports: (results.unusedExports?.length ?? 0),
    deadFiles: results.deadFiles?.length ?? 0,
    deadExports: results.unusedExports?.length ?? 0,
    unusedDeps: results.unusedDependencies?.length ?? 0,
    circularDeps: results.circularDependencies?.length ?? 0,
    totalDeps: results.allDependencies?.length ?? 0,
    duplicateExports: results.duplicateExports?.length ?? 0,
    boundaryViolations: results.boundaryViolations?.length ?? 0,
  };
}

/** Compute percentages from counts for use in vital signs. */
export function deadCodePct(counts: AnalysisCounts): number {
  if (counts.totalExports === 0) return 0;
  return (counts.deadExports / counts.totalExports) * 100;
}

export function unusedDepsPct(counts: AnalysisCounts): number {
  if (counts.totalDeps === 0) return 0;
  return (counts.unusedDeps / counts.totalDeps) * 100;
}

export function formatAnalysisCounts(counts: AnalysisCounts): string {
  return [
    `Dead files:    ${counts.deadFiles}`,
    `Dead exports:  ${counts.deadExports} / ${counts.totalExports} (${deadCodePct(counts).toFixed(1)}%)`,
    `Unused deps:   ${counts.unusedDeps} / ${counts.totalDeps} (${unusedDepsPct(counts).toFixed(1)}%)`,
    `Circular deps: ${counts.circularDeps}`,
    `Boundary viol: ${counts.boundaryViolations}`,
    `Dupe exports:  ${counts.duplicateExports}`,
  ].join('\n');
}
