import type { MonographDb } from '../storage/db.js';
export type AnalysisKind = 'dead-code' | 'duplication' | 'health';
export interface CombinedOptions {
    only?: AnalysisKind[];
    skip?: AnalysisKind[];
}
export interface CombinedResult {
    analyses: Set<AnalysisKind>;
    ranAt: string;
}
export declare function resolveAnalyses(opts: CombinedOptions): Set<AnalysisKind>;
export declare function runCombined(db: MonographDb, opts: CombinedOptions): Promise<CombinedResult>;
//# sourceMappingURL=combined.d.ts.map