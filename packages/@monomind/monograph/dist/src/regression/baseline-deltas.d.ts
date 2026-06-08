import type { FallowAnalysisResults } from '../results/fallow-results.js';
export interface CategoryDelta {
    category: string;
    before: number;
    after: number;
    added: number;
    resolved: number;
}
export interface BaselineDeltas {
    unusedFiles: CategoryDelta;
    unusedExports: CategoryDelta;
    unusedDeps: CategoryDelta;
    unusedMembers: CategoryDelta;
    unresolvedImports: CategoryDelta;
    cloneGroups: CategoryDelta;
    overall: CategoryDelta;
}
export declare function computeBaselineDeltas(baseline: FallowAnalysisResults, current: FallowAnalysisResults): BaselineDeltas;
export declare function filterNewIssues(baseline: FallowAnalysisResults, current: FallowAnalysisResults): FallowAnalysisResults;
export declare function formatBaselineDeltas(deltas: BaselineDeltas): string[];
//# sourceMappingURL=baseline-deltas.d.ts.map