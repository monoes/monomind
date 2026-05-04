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

export function effectiveSeverity(kind: IssueKindKey, rules: RulesConfig): IssueSeverity {
  return rules[kind] ?? 'error';
}

export function applyRules(issues: AnalysisIssue[], rules: RulesConfig): AnalysisIssue[] {
  return issues
    .filter(issue => effectiveSeverity(issue.kind, rules) !== 'off')
    .map(issue => ({ ...issue, severity: effectiveSeverity(issue.kind, rules) }));
}

export function hasErrorSeverityIssues(issues: AnalysisIssue[], rules: RulesConfig): boolean {
  return issues.some(issue => effectiveSeverity(issue.kind, rules) === 'error');
}

export const DEFAULT_RULES_CONFIG: RulesConfig = {
  unusedFiles: 'error',
  unusedExports: 'error',
  unusedDeps: 'warn',
  unusedTypes: 'warn',
  privateTypeLeaks: 'warn',
  unusedEnumMembers: 'warn',
  unusedClassMembers: 'warn',
  unresolvedImports: 'error',
  unlistedDeps: 'warn',
  duplicateExports: 'error',
  circularDeps: 'warn',
  boundaryViolations: 'error',
  staleSuppressions: 'warn',
};
