export type DependencyLocation = 'Dependencies' | 'DevDependencies' | 'OptionalDependencies' | 'PeerDependencies';
export interface UnusedFile {
    filePath: string;
    sizeBytes?: number;
}
export interface UnusedExport {
    filePath: string;
    exportName: string;
    line?: number;
    col?: number;
    isType?: boolean;
}
export interface UnusedMember {
    filePath: string;
    memberName: string;
    parentName?: string;
    kind?: 'method' | 'property' | 'getter' | 'setter' | 'accessor' | 'constructor';
    line?: number;
}
export interface UnusedDependency {
    name: string;
    location: DependencyLocation;
}
export interface CircularDependency {
    cycle: string[];
}
export interface BoundaryViolation {
    fromFile: string;
    toFile: string;
    fromBoundary: string;
    toBoundary: string;
}
export interface StaleSuppression {
    filePath: string;
    line: number;
    kind: string;
    comment: string;
}
export interface PrivateTypeLeak {
    filePath: string;
    exportName: string;
    leakedType: string;
    line?: number;
}
export interface DuplicateExport {
    exportName: string;
    files: string[];
}
export interface AnalysisResults {
    unusedFiles: UnusedFile[];
    unusedExports: UnusedExport[];
    unusedTypes: UnusedExport[];
    privateTypeLeaks: PrivateTypeLeak[];
    unusedDependencies: UnusedDependency[];
    unusedEnumMembers: UnusedMember[];
    unusedClassMembers: UnusedMember[];
    unresolvedImports: Array<{
        filePath: string;
        specifier: string;
        line?: number;
    }>;
    unlistedDependencies: UnusedDependency[];
    duplicateExports: DuplicateExport[];
    circularDependencies: CircularDependency[];
    boundaryViolations: BoundaryViolation[];
    staleSuppressions: StaleSuppression[];
}
export declare function makeEmptyAnalysisResults(): AnalysisResults;
export declare function totalIssues(results: AnalysisResults): number;
export declare function hasIssues(results: AnalysisResults): boolean;
export declare function mergeAnalysisResults(a: AnalysisResults, b: AnalysisResults): AnalysisResults;
export declare function filterResultsByFile(results: AnalysisResults, filePaths: Set<string>): AnalysisResults;
//# sourceMappingURL=types.d.ts.map