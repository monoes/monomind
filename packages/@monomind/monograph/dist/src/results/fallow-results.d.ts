import type { FallowIssueKind } from '../analysis/fallow-suppression.js';
import type { EntryPointSource } from '../discover/entry-points.js';
export type FallowDependencyLocation = 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies';
export type FallowMemberKind = 'method' | 'property' | 'getter' | 'setter' | 'constructor' | 'enum-member';
export type FallowFlagKind = 'environment' | 'feature-flag' | 'experiment' | 'rollout';
export type FallowFlagConfidence = 'low' | 'medium' | 'high';
export interface FallowUnusedFile {
    filePath: string;
    line: number;
    col: number;
}
export interface FallowUnusedExport {
    filePath: string;
    line: number;
    col: number;
    exportName: string;
    spanStart: number;
    isReExport: boolean;
    isTypeOnly: boolean;
}
export interface FallowPrivateTypeLeak {
    filePath: string;
    line: number;
    col: number;
    exportName: string;
    privateType: string;
}
export interface FallowUnusedDependency {
    name: string;
    location: FallowDependencyLocation;
    usedInWorkspaces: string[];
}
export interface FallowUnusedMember {
    filePath: string;
    line: number;
    col: number;
    memberName: string;
    parentName: string;
    kind: FallowMemberKind;
}
export interface FallowUnresolvedImport {
    filePath: string;
    line: number;
    col: number;
    specifier: string;
    specifierCol: number;
}
export interface FallowImportSite {
    filePath: string;
    line: number;
    col: number;
}
export interface FallowUnlistedDependency {
    name: string;
    importedFrom: FallowImportSite[];
}
export interface FallowDuplicateLocation {
    filePath: string;
    line: number;
    col: number;
    exportName: string;
}
export interface FallowDuplicateExport {
    exportName: string;
    locations: FallowDuplicateLocation[];
}
export interface FallowTypeOnlyDependency {
    name: string;
    location: FallowDependencyLocation;
}
export interface FallowTestOnlyDependency {
    name: string;
    location: FallowDependencyLocation;
}
export interface FallowCircularDependency {
    cycle: string[];
    line: number;
    col: number;
    isCrossPackage: boolean;
}
export interface FallowBoundaryViolation {
    fromPath: string;
    toPath: string;
    fromZone: string;
    toZone: string;
    importSpecifier: string;
    line: number;
    col: number;
}
export type FallowSuppressionOrigin = {
    kind: 'inline';
    line: number;
} | {
    kind: 'jsdoc';
    line: number;
} | {
    kind: 'file-wide';
};
export interface FallowStaleSuppression {
    filePath: string;
    commentLine: number;
    issueKind: FallowIssueKind | null;
    origin: FallowSuppressionOrigin;
}
export interface FallowFeatureFlag {
    filePath: string;
    line: number;
    col: number;
    flagName: string;
    kind: FallowFlagKind;
    confidence: FallowFlagConfidence;
    value: string | boolean | null;
    condition: string | null;
    branchTrue: string | null;
    branchFalse: string | null;
    isNegated: boolean;
    isDynamic: boolean;
    isMultiVariant: boolean;
}
export interface FallowEntryPointSummary {
    path: string;
    source: EntryPointSource;
}
export interface FallowExportUsage {
    exportName: string;
    usageCount: number;
}
export interface FallowReferenceLocation {
    filePath: string;
    line: number;
    col: number;
}
export interface FallowAnalysisResults {
    unusedFiles: FallowUnusedFile[];
    unusedExports: FallowUnusedExport[];
    unusedTypes: FallowUnusedExport[];
    privateTypeLeaks: FallowPrivateTypeLeak[];
    unusedDependencies: FallowUnusedDependency[];
    unusedDevDependencies: FallowUnusedDependency[];
    unusedEnumMembers: FallowUnusedMember[];
    unusedClassMembers: FallowUnusedMember[];
    unresolvedImports: FallowUnresolvedImport[];
    unlistedDependencies: FallowUnlistedDependency[];
    duplicateExports: FallowDuplicateExport[];
    typeOnlyDependencies: FallowTypeOnlyDependency[];
    testOnlyDependencies: FallowTestOnlyDependency[];
    circularDependencies: FallowCircularDependency[];
    boundaryViolations: FallowBoundaryViolation[];
    staleSuppressions: FallowStaleSuppression[];
    featureFlags: FallowFeatureFlag[];
}
export declare function makeEmptyFallowResults(): FallowAnalysisResults;
export declare function totalFallowIssues(results: FallowAnalysisResults): number;
export declare function hasFallowIssues(results: FallowAnalysisResults): boolean;
export declare function sortFallowResults(results: FallowAnalysisResults): void;
//# sourceMappingURL=fallow-results.d.ts.map