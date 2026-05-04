import type { FallowIssueKind } from '../analysis/fallow-suppression.js';
import type { EntryPointSource } from '../discover/entry-points.js';

export type FallowDependencyLocation = 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies';
export type FallowMemberKind = 'method' | 'property' | 'getter' | 'setter' | 'constructor' | 'enum-member';
export type FallowFlagKind = 'environment' | 'feature-flag' | 'experiment' | 'rollout';
export type FallowFlagConfidence = 'low' | 'medium' | 'high';

export interface FallowUnusedFile { filePath: string; line: number; col: number; }
export interface FallowUnusedExport { filePath: string; line: number; col: number; exportName: string; spanStart: number; isReExport: boolean; isTypeOnly: boolean; }
export interface FallowPrivateTypeLeak { filePath: string; line: number; col: number; exportName: string; privateType: string; }
export interface FallowUnusedDependency { name: string; location: FallowDependencyLocation; usedInWorkspaces: string[]; }
export interface FallowUnusedMember { filePath: string; line: number; col: number; memberName: string; parentName: string; kind: FallowMemberKind; }
export interface FallowUnresolvedImport { filePath: string; line: number; col: number; specifier: string; specifierCol: number; }
export interface FallowImportSite { filePath: string; line: number; col: number; }
export interface FallowUnlistedDependency { name: string; importedFrom: FallowImportSite[]; }
export interface FallowDuplicateLocation { filePath: string; line: number; col: number; exportName: string; }
export interface FallowDuplicateExport { exportName: string; locations: FallowDuplicateLocation[]; }
export interface FallowTypeOnlyDependency { name: string; location: FallowDependencyLocation; }
export interface FallowTestOnlyDependency { name: string; location: FallowDependencyLocation; }
export interface FallowCircularDependency { cycle: string[]; line: number; col: number; isCrossPackage: boolean; }
export interface FallowBoundaryViolation { fromPath: string; toPath: string; fromZone: string; toZone: string; importSpecifier: string; line: number; col: number; }
export type FallowSuppressionOrigin = { kind: 'inline'; line: number } | { kind: 'jsdoc'; line: number } | { kind: 'file-wide' };
export interface FallowStaleSuppression { filePath: string; commentLine: number; issueKind: FallowIssueKind | null; origin: FallowSuppressionOrigin; }
export interface FallowFeatureFlag { filePath: string; line: number; col: number; flagName: string; kind: FallowFlagKind; confidence: FallowFlagConfidence; value: string | boolean | null; condition: string | null; branchTrue: string | null; branchFalse: string | null; isNegated: boolean; isDynamic: boolean; isMultiVariant: boolean; }
export interface FallowEntryPointSummary { path: string; source: EntryPointSource; }
export interface FallowExportUsage { exportName: string; usageCount: number; }
export interface FallowReferenceLocation { filePath: string; line: number; col: number; }

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

export function makeEmptyFallowResults(): FallowAnalysisResults {
  return {
    unusedFiles: [],
    unusedExports: [],
    unusedTypes: [],
    privateTypeLeaks: [],
    unusedDependencies: [],
    unusedDevDependencies: [],
    unusedEnumMembers: [],
    unusedClassMembers: [],
    unresolvedImports: [],
    unlistedDependencies: [],
    duplicateExports: [],
    typeOnlyDependencies: [],
    testOnlyDependencies: [],
    circularDependencies: [],
    boundaryViolations: [],
    staleSuppressions: [],
    featureFlags: [],
  };
}

export function totalFallowIssues(results: FallowAnalysisResults): number {
  return (
    results.unusedFiles.length +
    results.unusedExports.length +
    results.unusedTypes.length +
    results.privateTypeLeaks.length +
    results.unusedDependencies.length +
    results.unusedDevDependencies.length +
    results.unusedEnumMembers.length +
    results.unusedClassMembers.length +
    results.unresolvedImports.length +
    results.unlistedDependencies.length +
    results.duplicateExports.length +
    results.typeOnlyDependencies.length +
    results.testOnlyDependencies.length +
    results.circularDependencies.length +
    results.boundaryViolations.length +
    results.staleSuppressions.length +
    results.featureFlags.length
  );
}

export function hasFallowIssues(results: FallowAnalysisResults): boolean {
  return totalFallowIssues(results) > 0;
}

function cmpFileLineCol(
  a: { filePath: string; line: number; col: number },
  b: { filePath: string; line: number; col: number },
): number {
  if (a.filePath < b.filePath) return -1;
  if (a.filePath > b.filePath) return 1;
  if (a.line !== b.line) return a.line - b.line;
  return a.col - b.col;
}

export function sortFallowResults(results: FallowAnalysisResults): void {
  results.unusedFiles.sort(cmpFileLineCol);
  results.unusedExports.sort(cmpFileLineCol);
  results.unusedTypes.sort(cmpFileLineCol);
  results.privateTypeLeaks.sort(cmpFileLineCol);
  results.unusedEnumMembers.sort(cmpFileLineCol);
  results.unusedClassMembers.sort(cmpFileLineCol);
  results.unresolvedImports.sort(cmpFileLineCol);

  results.unusedDependencies.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  results.unusedDevDependencies.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  results.typeOnlyDependencies.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  results.testOnlyDependencies.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  results.unlistedDependencies.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  results.duplicateExports.sort((a, b) => (a.exportName < b.exportName ? -1 : a.exportName > b.exportName ? 1 : 0));

  results.circularDependencies.sort((a, b) => {
    const ac = a.cycle[0] ?? '';
    const bc = b.cycle[0] ?? '';
    if (ac < bc) return -1;
    if (ac > bc) return 1;
    return a.line - b.line;
  });

  results.boundaryViolations.sort((a, b) => {
    if (a.fromPath < b.fromPath) return -1;
    if (a.fromPath > b.fromPath) return 1;
    return a.line - b.line;
  });

  results.staleSuppressions.sort((a, b) => {
    if (a.filePath < b.filePath) return -1;
    if (a.filePath > b.filePath) return 1;
    return a.commentLine - b.commentLine;
  });

  results.featureFlags.sort((a, b) => {
    if (a.filePath < b.filePath) return -1;
    if (a.filePath > b.filePath) return 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.flagName < b.flagName ? -1 : a.flagName > b.flagName ? 1 : 0;
  });
}
