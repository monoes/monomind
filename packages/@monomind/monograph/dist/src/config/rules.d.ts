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
export declare const DEFAULT_RULES_CONFIG: RulesConfig;
export declare function mergeRulesConfig(base: RulesConfig, partial: PartialRulesConfig): RulesConfig;
export declare function severityToExitCode(severity: Severity): number;
export declare function issueSeverityFor(rules: RulesConfig, issueKind: keyof RulesConfig): Severity;
export declare const ALL_ISSUE_KINDS: Array<keyof RulesConfig>;
//# sourceMappingURL=rules.d.ts.map