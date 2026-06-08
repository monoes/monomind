import type { MonographDb } from '../storage/db.js';
export type RuntimeClassification = 'SafeToDelete' | 'ReviewRequired' | 'LowTraffic' | 'Active' | 'CoverageUnavailable';
export interface FunctionCoverageEntry {
    nodeId: string;
    name: string;
    filePath: string | null;
    startLine: number | null;
    covered: boolean;
    callCount: number;
    classification: RuntimeClassification;
}
export interface RuntimeCoverageReport {
    entries: FunctionCoverageEntry[];
    safeToDelete: number;
    reviewRequired: number;
    active: number;
    coverageUnavailable: number;
    blastRadius: string[];
}
export interface V8CoverageFunction {
    functionName: string;
    url: string;
    ranges: Array<{
        startOffset: number;
        endOffset: number;
        count: number;
    }>;
}
export interface V8Coverage {
    result: Array<{
        url: string;
        functions: V8CoverageFunction[];
    }>;
}
export declare function analyzeRuntimeCoverage(db: MonographDb, coverage: V8Coverage, repoRoot?: string): RuntimeCoverageReport;
//# sourceMappingURL=runtime.d.ts.map