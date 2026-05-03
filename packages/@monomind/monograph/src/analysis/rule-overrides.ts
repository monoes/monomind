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
