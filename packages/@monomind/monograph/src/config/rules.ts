// Per-issue-type severity configuration for all 19 fallow issue categories.

export type Severity = 'error' | 'warn' | 'off';

export interface RulesConfig {
  unusedFiles: Severity;
  unusedExports: Severity;
  unusedTypes: Severity;
  privateTypeLeaks: Severity;
  unusedDependencies: Severity;
  unusedDevDependencies: Severity;
  unusedOptionalDependencies: Severity;
  unusedEnumMembers: Severity;
  unusedClassMembers: Severity;
  unresolvedImports: Severity;
  unlistedDependencies: Severity;
  duplicateExports: Severity;
  typeOnlyDependencies: Severity;
  testOnlyDependencies: Severity;
  circularDependencies: Severity;
  boundaryViolation: Severity;
  coverageGaps: Severity;
  featureFlags: Severity;
  staleSuppressions: Severity;
}

export type PartialRulesConfig = Partial<RulesConfig>;

export const DEFAULT_RULES_CONFIG: RulesConfig = {
  unusedFiles: 'error',
  unusedExports: 'error',
  unusedTypes: 'error',
  privateTypeLeaks: 'error',
  unusedDependencies: 'error',
  unusedDevDependencies: 'warn',
  unusedOptionalDependencies: 'warn',
  unusedEnumMembers: 'error',
  unusedClassMembers: 'warn',
  unresolvedImports: 'error',
  unlistedDependencies: 'error',
  duplicateExports: 'warn',
  typeOnlyDependencies: 'warn',
  testOnlyDependencies: 'warn',
  circularDependencies: 'warn',
  boundaryViolation: 'error',
  coverageGaps: 'warn',
  featureFlags: 'warn',
  staleSuppressions: 'warn',
};

export function mergeRulesConfig(base: RulesConfig, partial: PartialRulesConfig): RulesConfig {
  return { ...base, ...partial };
}

export function severityToExitCode(severity: Severity): number {
  return severity === 'error' ? 1 : 0;
}

export function issueSeverityFor(rules: RulesConfig, issueKind: keyof RulesConfig): Severity {
  return rules[issueKind];
}

export const ALL_ISSUE_KINDS: Array<keyof RulesConfig> = [
  'unusedFiles', 'unusedExports', 'unusedTypes', 'privateTypeLeaks',
  'unusedDependencies', 'unusedDevDependencies', 'unusedOptionalDependencies',
  'unusedEnumMembers', 'unusedClassMembers', 'unresolvedImports',
  'unlistedDependencies', 'duplicateExports', 'typeOnlyDependencies',
  'testOnlyDependencies', 'circularDependencies', 'boundaryViolation',
  'coverageGaps', 'featureFlags', 'staleSuppressions',
];
