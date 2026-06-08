import type { RulesConfig, AnalysisIssue } from './rules.js';
import type { OutputFormat, TraceOptions } from './output.js';
export * from './rules.js';
export * from './filtering.js';
export * from './output.js';
export interface IssueFilters {
    unusedFiles: boolean;
    unusedExports: boolean;
    unusedDeps: boolean;
    unusedTypes: boolean;
    privateTypeLeaks: boolean;
    unusedEnumMembers: boolean;
    unusedClassMembers: boolean;
    unresolvedImports: boolean;
    unlistedDeps: boolean;
    duplicateExports: boolean;
    circularDeps: boolean;
    boundaryViolations: boolean;
    staleSuppressions: boolean;
}
export interface CheckOptions {
    root: string;
    configPath?: string;
    output: OutputFormat;
    noCache: boolean;
    threads: number;
    quiet: boolean;
    failOnIssues: boolean;
    filters: IssueFilters;
    changedSince?: string;
    baseline?: string;
    saveBaseline?: string;
    sarifFile?: string;
    production: boolean;
    productionOverride?: boolean;
    workspace?: string[];
    changedWorkspaces?: string;
    trace?: TraceOptions;
}
export declare const DEFAULT_ISSUE_FILTERS: IssueFilters;
export interface CheckResult {
    issues: AnalysisIssue[];
    hasErrors: boolean;
    filteredByWorkspace: boolean;
}
export declare function runCheckFilter(issues: AnalysisIssue[], opts: Pick<CheckOptions, 'filters' | 'workspace' | 'changedWorkspaces' | 'root'>, rules?: RulesConfig, allWorkspaceRoots?: string[]): CheckResult;
//# sourceMappingURL=index.d.ts.map