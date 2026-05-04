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
  unresolvedImports: Array<{ filePath: string; specifier: string; line?: number }>;
  unlistedDependencies: UnusedDependency[];
  duplicateExports: DuplicateExport[];
  circularDependencies: CircularDependency[];
  boundaryViolations: BoundaryViolation[];
  staleSuppressions: StaleSuppression[];
}

export function makeEmptyAnalysisResults(): AnalysisResults {
  return {
    unusedFiles: [],
    unusedExports: [],
    unusedTypes: [],
    privateTypeLeaks: [],
    unusedDependencies: [],
    unusedEnumMembers: [],
    unusedClassMembers: [],
    unresolvedImports: [],
    unlistedDependencies: [],
    duplicateExports: [],
    circularDependencies: [],
    boundaryViolations: [],
    staleSuppressions: [],
  };
}

export function totalIssues(results: AnalysisResults): number {
  return (
    results.unusedFiles.length +
    results.unusedExports.length +
    results.unusedTypes.length +
    results.privateTypeLeaks.length +
    results.unusedDependencies.length +
    results.unusedEnumMembers.length +
    results.unusedClassMembers.length +
    results.unresolvedImports.length +
    results.unlistedDependencies.length +
    results.duplicateExports.length +
    results.circularDependencies.length +
    results.boundaryViolations.length +
    results.staleSuppressions.length
  );
}

export function hasIssues(results: AnalysisResults): boolean {
  return totalIssues(results) > 0;
}

export function mergeAnalysisResults(a: AnalysisResults, b: AnalysisResults): AnalysisResults {
  return {
    unusedFiles: [...a.unusedFiles, ...b.unusedFiles],
    unusedExports: [...a.unusedExports, ...b.unusedExports],
    unusedTypes: [...a.unusedTypes, ...b.unusedTypes],
    privateTypeLeaks: [...a.privateTypeLeaks, ...b.privateTypeLeaks],
    unusedDependencies: [...a.unusedDependencies, ...b.unusedDependencies],
    unusedEnumMembers: [...a.unusedEnumMembers, ...b.unusedEnumMembers],
    unusedClassMembers: [...a.unusedClassMembers, ...b.unusedClassMembers],
    unresolvedImports: [...a.unresolvedImports, ...b.unresolvedImports],
    unlistedDependencies: [...a.unlistedDependencies, ...b.unlistedDependencies],
    duplicateExports: [...a.duplicateExports, ...b.duplicateExports],
    circularDependencies: [...a.circularDependencies, ...b.circularDependencies],
    boundaryViolations: [...a.boundaryViolations, ...b.boundaryViolations],
    staleSuppressions: [...a.staleSuppressions, ...b.staleSuppressions],
  };
}

export function filterResultsByFile(results: AnalysisResults, filePaths: Set<string>): AnalysisResults {
  return {
    unusedFiles: results.unusedFiles.filter(r => filePaths.has(r.filePath)),
    unusedExports: results.unusedExports.filter(r => filePaths.has(r.filePath)),
    unusedTypes: results.unusedTypes.filter(r => filePaths.has(r.filePath)),
    privateTypeLeaks: results.privateTypeLeaks.filter(r => filePaths.has(r.filePath)),
    unusedDependencies: results.unusedDependencies,
    unusedEnumMembers: results.unusedEnumMembers.filter(r => filePaths.has(r.filePath)),
    unusedClassMembers: results.unusedClassMembers.filter(r => filePaths.has(r.filePath)),
    unresolvedImports: results.unresolvedImports.filter(r => filePaths.has(r.filePath)),
    unlistedDependencies: results.unlistedDependencies,
    duplicateExports: results.duplicateExports,
    circularDependencies: results.circularDependencies.filter(c => c.cycle.some(f => filePaths.has(f))),
    boundaryViolations: results.boundaryViolations.filter(b => filePaths.has(b.fromFile)),
    staleSuppressions: results.staleSuppressions.filter(r => filePaths.has(r.filePath)),
  };
}
