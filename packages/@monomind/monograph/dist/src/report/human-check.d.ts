import type { FallowAnalysisResults, FallowUnusedFile, FallowUnusedExport, FallowUnusedDependency, FallowUnusedMember, FallowUnresolvedImport } from '../results/fallow-results.js';
export interface HumanCheckOptions {
    maxFlatItems?: number;
    maxGroupedFiles?: number;
    maxItemsPerFile?: number;
    top?: number;
}
export declare function formatUnusedFiles(files: FallowUnusedFile[], opts?: HumanCheckOptions): string[];
export declare function formatUnusedExports(exports: FallowUnusedExport[], opts?: HumanCheckOptions): string[];
export declare function formatUnusedDeps(deps: FallowUnusedDependency[]): string[];
export declare function formatUnusedMembers(members: FallowUnusedMember[], title?: string): string[];
export declare function formatUnresolvedImports(imports: FallowUnresolvedImport[]): string[];
export declare function buildCheckHumanLines(results: FallowAnalysisResults, opts?: HumanCheckOptions): string[];
//# sourceMappingURL=human-check.d.ts.map