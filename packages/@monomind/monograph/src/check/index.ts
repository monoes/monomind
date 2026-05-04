import type { RulesConfig, AnalysisIssue } from './rules.js';
import { applyRules, hasErrorSeverityIssues, DEFAULT_RULES_CONFIG } from './rules.js';
import type { OutputFormat, TraceOptions } from './output.js';
import { filterToWorkspaces, resolveWorkspaceScope } from './filtering.js';

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

export const DEFAULT_ISSUE_FILTERS: IssueFilters = {
  unusedFiles: true,
  unusedExports: true,
  unusedDeps: true,
  unusedTypes: true,
  privateTypeLeaks: true,
  unusedEnumMembers: true,
  unusedClassMembers: true,
  unresolvedImports: true,
  unlistedDeps: true,
  duplicateExports: true,
  circularDeps: true,
  boundaryViolations: true,
  staleSuppressions: true,
};

export interface CheckResult {
  issues: AnalysisIssue[];
  hasErrors: boolean;
  filteredByWorkspace: boolean;
}

export function runCheckFilter(
  issues: AnalysisIssue[],
  opts: Pick<CheckOptions, 'filters' | 'workspace' | 'changedWorkspaces' | 'root'>,
  rules: RulesConfig = DEFAULT_RULES_CONFIG,
  allWorkspaceRoots: string[] = [],
): CheckResult {
  let filtered = applyRules(issues, rules);

  const activeFilters = opts.filters;
  filtered = filtered.filter(issue => {
    const key = issue.kind as keyof IssueFilters;
    return activeFilters[key] !== false;
  });

  const wsRoots = resolveWorkspaceScope(
    opts.root,
    opts.workspace,
    opts.changedWorkspaces,
    allWorkspaceRoots,
  );

  const filteredByWorkspace = wsRoots.length > 0;
  if (filteredByWorkspace) {
    filtered = filterToWorkspaces(filtered, wsRoots);
  }

  return {
    issues: filtered,
    hasErrors: hasErrorSeverityIssues(filtered, rules),
    filteredByWorkspace,
  };
}
