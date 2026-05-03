export interface RuleSet {
  allow: string[];
  deny: string[];
}

export interface RuleOverride {
  pattern: string;
  rules: RuleSet;
}

export function matchesGlob(filePath: string, pattern: string): boolean {
  // Escape dots
  let regexStr = pattern.replace(/\./g, '\\.');
  // Replace **/ with a group that matches any path segments (including none)
  regexStr = regexStr.replace(/\*\*\//g, '(?:.+/)?');
  // Replace remaining * with [^/]* to match within a segment only
  regexStr = regexStr.replace(/\*/g, '[^/]*');
  // Anchor at end
  regexStr = regexStr + '$';

  const regex = new RegExp(regexStr);
  return regex.test(filePath);
}

export function resolveRulesForFile(filePath: string, overrides: RuleOverride[]): RuleSet | null {
  for (const override of overrides) {
    if (matchesGlob(filePath, override.pattern)) {
      return override.rules;
    }
  }
  return null;
}

export function applyRules<T extends { filePath?: string | null; ruleCode?: string }>(
  issues: T[],
  globalRules: RuleSet,
  overrides: RuleOverride[],
): T[] {
  return issues.filter((issue) => {
    const filePath = issue.filePath ?? '';
    const effectiveRules = resolveRulesForFile(filePath, overrides) ?? globalRules;

    const ruleCode = issue.ruleCode;
    if (ruleCode == null) {
      // No ruleCode — keep by default
      return true;
    }

    // Keep if ruleCode is NOT in allow list
    return !effectiveRules.allow.includes(ruleCode);
  });
}

// ── Round 8: severity helpers ──────────────────────────────────────────────

export type IssueSeverity = 'error' | 'warn' | 'off';

export interface RuleWithSeverity {
  name: string;
  severity: IssueSeverity;
}

/** Returns true if any rule currently set to 'error' has findings in results. */
export function hasErrorSeverityIssues(
  rules: RuleWithSeverity[],
  resultCounts: Record<string, number>,
): boolean {
  return rules
    .filter(r => r.severity === 'error')
    .some(r => (resultCounts[r.name] ?? 0) > 0);
}

/** Bulk-upgrade all 'warn' severity rules to 'error' for strict CI gates. */
export function promoteWarnsToErrors(rules: RuleWithSeverity[]): RuleWithSeverity[] {
  return rules.map(r => r.severity === 'warn' ? { ...r, severity: 'error' as IssueSeverity } : r);
}

/** Downgrade all 'error' severity rules to 'warn'. */
export function demoteErrorsToWarns(rules: RuleWithSeverity[]): RuleWithSeverity[] {
  return rules.map(r => r.severity === 'error' ? { ...r, severity: 'warn' as IssueSeverity } : r);
}
