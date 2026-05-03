// Extended runtime coverage report model with confidence scoring,
// multi-source evidence, hot-path tracking, and blast-radius analysis.

export type RuntimeCoverageConfidence = 'high' | 'medium' | 'low' | 'unavailable';
export type RuntimeCoverageWatermark = 'hotPath' | 'warm' | 'cold' | 'unknown';
export type RuntimeCoverageDataSource = 'cloudApi' | 'localSidecar' | 'istanbulFile' | 'none';

export interface RuntimeCoverageHotPath {
  endpoint: string;
  requestsPerDay: number;
}

export interface RuntimeCoverageBlastRadiusEntry {
  filePath: string;
  fanIn: number;
}

export interface RuntimeCoverageImportanceEntry {
  filePath: string;
  score: number;
}

export interface RuntimeCoverageEvidence {
  callCount: number | null;
  lastCalledAt: string | null;
  coveragePct: number | null;
  requestsPerDay: number | null;
}

export interface RuntimeCoverageCaptureQuality {
  confidence: RuntimeCoverageConfidence;
  dataSource: RuntimeCoverageDataSource;
}

export interface RuntimeCoverageMessage {
  code: string;
  text: string;
  learnMoreUrl?: string;
}

export interface RuntimeCoverageFinding {
  filePath: string;
  watermark: RuntimeCoverageWatermark;
  evidence: RuntimeCoverageEvidence;
  quality: RuntimeCoverageCaptureQuality;
  messages: RuntimeCoverageMessage[];
  hotPaths: RuntimeCoverageHotPath[];
  blastRadius: RuntimeCoverageBlastRadiusEntry[];
  importance: RuntimeCoverageImportanceEntry[];
  recommendedAction: string;
}

export interface RuntimeCoverageSummary {
  totalFiles: number;
  hotPathFiles: number;
  warmFiles: number;
  coldFiles: number;
  unknownFiles: number;
  averageCoveragePct: number | null;
  dataSource: RuntimeCoverageDataSource;
}

export interface RuntimeCoverageReport {
  findings: RuntimeCoverageFinding[];
  summary: RuntimeCoverageSummary;
  generatedAt: string;
}

export function buildRuntimeCoverageSummary(findings: RuntimeCoverageFinding[]): RuntimeCoverageSummary {
  const counts = { hotPath: 0, warm: 0, cold: 0, unknown: 0 };
  let totalPct = 0;
  let pctCount = 0;
  let dataSource: RuntimeCoverageDataSource = 'none';

  for (const f of findings) {
    counts[f.watermark as keyof typeof counts]++;
    if (f.evidence.coveragePct !== null) {
      totalPct += f.evidence.coveragePct;
      pctCount++;
    }
    if (f.quality.dataSource !== 'none') dataSource = f.quality.dataSource;
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

export function createRuntimeCoverageReport(findings: RuntimeCoverageFinding[]): RuntimeCoverageReport {
  return {
    findings,
    summary: buildRuntimeCoverageSummary(findings),
    generatedAt: new Date().toISOString(),
  };
}
