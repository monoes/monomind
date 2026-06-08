export interface RuleSet {
    allow: string[];
    deny: string[];
}
export interface RuleOverride {
    pattern: string;
    rules: RuleSet;
}
export declare function matchesGlob(filePath: string, pattern: string): boolean;
export declare function resolveRulesForFile(filePath: string, overrides: RuleOverride[]): RuleSet | null;
export declare function applyRules<T extends {
    filePath?: string | null;
    ruleCode?: string;
}>(issues: T[], globalRules: RuleSet, overrides: RuleOverride[]): T[];
export type IssueSeverity = 'error' | 'warn' | 'off';
export interface RuleWithSeverity {
    name: string;
    severity: IssueSeverity;
}
/** Returns true if any rule currently set to 'error' has findings in results. */
export declare function hasErrorSeverityIssues(rules: RuleWithSeverity[], resultCounts: Record<string, number>): boolean;
/** Bulk-upgrade all 'warn' severity rules to 'error' for strict CI gates. */
export declare function promoteWarnsToErrors(rules: RuleWithSeverity[]): RuleWithSeverity[];
/** Downgrade all 'error' severity rules to 'warn'. */
export declare function demoteErrorsToWarns(rules: RuleWithSeverity[]): RuleWithSeverity[];
//# sourceMappingURL=rule-overrides.d.ts.map