// CLI argument builders that convert structured MCP params into argv arrays
// for all monograph CLI tools.

import type {
  AnalyzeParams, HealthParams, AuditParams, FindDupesParams,
  TraceExportParams, TraceFileParams, TraceDependencyParams,
  TraceCloneParams, ProjectInfoParams, FeatureFlagsParams,
  ListBoundariesParams, CheckRuntimeCoverageParams,
} from './params.js';

function flag(key: string, val: unknown): string[] {
  if (val === undefined || val === null || val === false) return [];
  if (val === true) return [`--${key}`];
  if (Array.isArray(val)) return val.flatMap(v => [`--${key}`, String(v)]);
  return [`--${key}`, String(val)];
}

export interface CheckChangedParams {
  root: string;
  gitRef?: string;
  filters?: string[];
  workspace?: string;
  includeEntryFiles?: boolean;
}

export interface FixParams {
  root: string;
  apply?: boolean;
  filterUnused?: boolean;
  filterDeps?: boolean;
}

export interface ExplainParams {
  ruleId: string;
  verbose?: boolean;
}

export function buildAnalyzeArgs(p: AnalyzeParams): string[] {
  return [
    'analyze',
    p.root,
    ...flag('entry', p.entryPatterns),
    ...flag('project', p.tsconfig),
    ...flag('reporter', p.reporter),
    ...flag('no-gitignore', p.noGitignore),
    ...flag('production', p.production),
    ...flag('include-entry-exports', p.includeEntryExports),
  ].filter(Boolean);
}

export function buildHealthArgs(p: HealthParams): string[] {
  return [
    'health',
    p.root,
    ...flag('complexity-threshold', p.complexityThreshold),
    ...flag('crap-threshold', p.crapThreshold),
    ...flag('reporter', p.reporter),
    ...flag('include-hotspots', p.includeHotspots),
    ...flag('coverage-file', p.coverageFile),
  ].filter(Boolean);
}

export function buildAuditArgs(p: AuditParams): string[] {
  return ['audit', p.root, ...flag('gate', p.gate), ...flag('reporter', p.reporter)].filter(Boolean);
}

export function buildFindDupesArgs(p: FindDupesParams): string[] {
  return [
    'find-dupes',
    p.root,
    ...flag('min-lines', p.minLines),
    ...flag('min-tokens', p.minTokens),
    ...flag('reporter', p.reporter),
  ].filter(Boolean);
}

export function buildTraceExportArgs(p: TraceExportParams): string[] {
  return ['trace-export', p.root, p.exportName, p.filePath].filter(Boolean) as string[];
}

export function buildTraceFileArgs(p: TraceFileParams): string[] {
  return ['trace-file', p.root, p.filePath].filter(Boolean) as string[];
}

export function buildTraceDependencyArgs(p: TraceDependencyParams): string[] {
  return ['trace-dependency', p.root, p.from, p.to].filter(Boolean) as string[];
}

export function buildTraceCloneArgs(p: TraceCloneParams): string[] {
  return ['trace-clone', p.root, ...flag('group-id', p.groupId)].filter(Boolean);
}

export function buildProjectInfoArgs(p: ProjectInfoParams): string[] {
  return ['project-info', p.root, ...flag('reporter', p.reporter)].filter(Boolean);
}

export function buildFeatureFlagsArgs(p: FeatureFlagsParams): string[] {
  return ['feature-flags', p.root, ...flag('reporter', p.reporter)].filter(Boolean);
}

export function buildListBoundariesArgs(p: ListBoundariesParams): string[] {
  return ['list-boundaries', p.root, ...flag('reporter', p.reporter)].filter(Boolean);
}

export function buildCheckRuntimeCoverageArgs(p: CheckRuntimeCoverageParams): string[] {
  return ['check-runtime-coverage', p.root, ...flag('reporter', p.reporter), ...flag('min-confidence', p.minConfidence)].filter(Boolean);
}

export function buildCheckChangedArgs(p: CheckChangedParams): string[] {
  return [
    'check',
    p.root,
    ...flag('changed-since', p.gitRef),
    ...flag('workspace', p.workspace),
    ...flag('include-entry-files', p.includeEntryFiles),
    ...flag('filter', p.filters),
  ].filter(Boolean);
}

export function buildFixPreviewArgs(p: FixParams): string[] {
  return [
    'fix',
    p.root,
    '--dry-run',
    ...flag('unused', p.filterUnused),
    ...flag('deps', p.filterDeps),
  ].filter(Boolean);
}

export function buildFixApplyArgs(p: FixParams): string[] {
  return [
    'fix',
    p.root,
    ...flag('unused', p.filterUnused),
    ...flag('deps', p.filterDeps),
  ].filter(Boolean);
}

export function buildExplainArgs(p: ExplainParams): string[] {
  return ['explain', p.ruleId, ...flag('verbose', p.verbose)].filter(Boolean);
}

// ── Round 10: runtime-coverage sub-command builders ───────────────────────────

export interface GetHotPathsParams {
  root: string;
  minRequestsPerDay?: number;
  limit?: number;
}

export interface GetBlastRadiusParams {
  root: string;
  filePath: string;
  limit?: number;
}

export interface GetImportanceParams {
  root: string;
  limit?: number;
  minScore?: number;
}

export interface GetCleanupCandidatesParams {
  root: string;
  maxCoveragePct?: number;
  limit?: number;
}

export function buildGetHotPathsArgs(p: GetHotPathsParams): string[] {
  return [
    'get-hot-paths', p.root,
    ...flag('min-requests-per-day', p.minRequestsPerDay),
    ...flag('limit', p.limit),
  ].filter(Boolean);
}

export function buildGetBlastRadiusArgs(p: GetBlastRadiusParams): string[] {
  return [
    'get-blast-radius', p.root, p.filePath,
    ...flag('limit', p.limit),
  ].filter(Boolean);
}

export function buildGetImportanceArgs(p: GetImportanceParams): string[] {
  return [
    'get-importance', p.root,
    ...flag('limit', p.limit),
    ...flag('min-score', p.minScore),
  ].filter(Boolean);
}

export function buildGetCleanupCandidatesArgs(p: GetCleanupCandidatesParams): string[] {
  return [
    'get-cleanup-candidates', p.root,
    ...flag('max-coverage-pct', p.maxCoveragePct),
    ...flag('limit', p.limit),
  ].filter(Boolean);
}
