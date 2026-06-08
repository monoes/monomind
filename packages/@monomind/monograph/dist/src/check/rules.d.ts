export type IssueSeverity = 'error' | 'warn' | 'off';
export interface RuleEntry {
    severity: IssueSeverity;
    pattern?: string;
}
export interface RulesConfig {
    unusedFiles?: IssueSeverity;
    unusedExports?: IssueSeverity;
    unusedDeps?: IssueSeverity;
    unusedTypes?: IssueSeverity;
    privateTypeLeaks?: IssueSeverity;
    unusedEnumMembers?: IssueSeverity;
    unusedClassMembers?: IssueSeverity;
    unresolvedImports?: IssueSeverity;
    unlistedDeps?: IssueSeverity;
    duplicateExports?: IssueSeverity;
    circularDeps?: IssueSeverity;
    boundaryViolations?: IssueSeverity;
    staleSuppressions?: IssueSeverity;
}
export type IssueKindKey = keyof RulesConfig;
export interface AnalysisIssue {
    kind: IssueKindKey;
    filePath: string;
    message: string;
    severity?: IssueSeverity;
}
export declare function effectiveSeverity(kind: IssueKindKey, rules: RulesConfig): IssueSeverity;
export declare function applyRules(issues: AnalysisIssue[], rules: RulesConfig): AnalysisIssue[];
export declare function hasErrorSeverityIssues(issues: AnalysisIssue[], rules: RulesConfig): boolean;
export declare const DEFAULT_RULES_CONFIG: RulesConfig;
//# sourceMappingURL=rules.d.ts.map