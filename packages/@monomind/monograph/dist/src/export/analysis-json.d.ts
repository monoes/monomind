export declare const ANALYSIS_JSON_SCHEMA_VERSION = 1;
export interface AnalysisEnvelopeOptions {
    elapsedMs?: number;
    entryCount?: number;
    schemaVersion?: number;
}
export interface AnalysisResultsEnvelope {
    schemaVersion: number;
    kind: 'analysis';
    elapsedMs: number;
    entryCount: number;
    totalIssues: number;
    results: unknown;
}
export interface HealthResultsEnvelope {
    schemaVersion: number;
    kind: 'health';
    elapsedMs: number;
    totalFindings: number;
    includesExplanations: boolean;
    results: unknown;
}
export interface DuplicationResultsEnvelope {
    schemaVersion: number;
    kind: 'duplication';
    elapsedMs: number;
    cloneGroups: number;
    includesExplanations: boolean;
    results: unknown;
}
export declare function buildAnalysisResultsEnvelope(results: unknown, totalIssues: number, opts?: AnalysisEnvelopeOptions): AnalysisResultsEnvelope;
export declare function buildHealthResultsEnvelope(results: unknown, totalFindings: number, opts?: AnalysisEnvelopeOptions & {
    includesExplanations?: boolean;
}): HealthResultsEnvelope;
export declare function buildDuplicationResultsEnvelope(results: unknown, cloneGroups: number, opts?: AnalysisEnvelopeOptions & {
    includesExplanations?: boolean;
}): DuplicationResultsEnvelope;
export declare function stripRootPrefix(obj: unknown, rootPrefix: string): unknown;
//# sourceMappingURL=analysis-json.d.ts.map