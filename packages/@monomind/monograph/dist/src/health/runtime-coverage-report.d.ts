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
export declare function buildRuntimeCoverageSummary(findings: RuntimeCoverageFinding[]): RuntimeCoverageSummary;
export declare function createRuntimeCoverageReport(findings: RuntimeCoverageFinding[]): RuntimeCoverageReport;
//# sourceMappingURL=runtime-coverage-report.d.ts.map