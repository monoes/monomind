import type { ExceededThreshold, FindingSeverity } from './scores.js';
import type { TrendDirection, TrendMetric, TrendPoint } from './trend-types.js';

export type HealthGradeLetter = 'A' | 'B' | 'C' | 'D' | 'F';

export const HOTSPOT_SCORE_THRESHOLD = 50.0;

export function letterGrade(score: number): HealthGradeLetter {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export interface HealthScorePenalties {
  complexity: number;
  duplication: number;
  deadCode: number;
  coupling: number;
  maintainability: number;
}

export interface HealthScore {
  score: number;
  grade: HealthGradeLetter;
  penalties: HealthScorePenalties;
}

export interface HealthFinding {
  path: string;
  name: string;
  line?: number;
  col?: number;
  cyclomatic?: number;
  cognitive?: number;
  lineCount?: number;
  paramCount?: number;
  exceeded?: ExceededThreshold;
  severity?: FindingSeverity;
  crap?: number;
  coveragePct?: number;
}

export interface FileScore {
  path: string;
  maintainabilityIndex?: number;
  fanIn?: number;
  fanOut?: number;
  deadCodeRatio?: number;
  complexityDensity?: number;
  crapMax?: number;
  crapAboveThreshold?: number;
}

export interface UnitSizeProfile {
  tiny: number;
  small: number;
  medium: number;
  large: number;
  huge: number;
}

export interface IssueCounts {
  unusedFiles: number;
  unusedExports: number;
  unusedTypes: number;
  privateTypeLeaks: number;
  unusedDependencies: number;
  unresolvedImports: number;
  circularDependencies: number;
  boundaryViolations: number;
}

export interface VitalSigns {
  deadFilePct: number;
  deadExportPct: number;
  avgCyclomatic: number;
  p90Cyclomatic: number;
  duplicationPct: number;
  hotspotCount: number;
  maintainabilityAvg: number;
  unusedDepCount: number;
  circularDepCount: number;
  counts: IssueCounts;
  unitSizeProfile: UnitSizeProfile;
  couplingHighPct: number;
}

export interface RuntimeCoverageEvidence {
  triggeredFiles: number;
  totalFiles: number;
  pct: number;
}

export type RuntimeCoverageVerdict = 'Sufficient' | 'Low' | 'Missing' | 'Unknown';

export interface RuntimeCoverageSummary {
  verdict: RuntimeCoverageVerdict;
  evidence?: RuntimeCoverageEvidence;
  message?: string;
}

export interface HealthTrend {
  comparedTo: TrendPoint;
  metrics: TrendMetric[];
  overallDirection: TrendDirection;
}

export interface HealthReport {
  score: HealthScore;
  findings: HealthFinding[];
  fileScores: FileScore[];
  vitalSigns?: VitalSigns;
  hotspots: HealthFinding[];
  trend?: HealthTrend;
  runtimeCoverage?: RuntimeCoverageSummary;
  generatedAt: string;
  root: string;
}

export function makeHealthScore(score: number, penalties: Partial<HealthScorePenalties> = {}): HealthScore {
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

export function computeVitalSigns(partial: Partial<VitalSigns>): VitalSigns {
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

export function formatVitalSigns(vs: VitalSigns): string[] {
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
