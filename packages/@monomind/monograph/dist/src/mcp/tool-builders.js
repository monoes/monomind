// CLI argument builders that convert structured MCP params into argv arrays
// for all monograph CLI tools.
function flag(key, val) {
    if (val === undefined || val === null || val === false)
        return [];
    if (val === true)
        return [`--${key}`];
    if (Array.isArray(val))
        return val.flatMap(v => [`--${key}`, String(v)]);
    return [`--${key}`, String(val)];
}
export function buildAnalyzeArgs(p) {
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
export function buildHealthArgs(p) {
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
export function buildAuditArgs(p) {
    return ['audit', p.root, ...flag('gate', p.gate), ...flag('reporter', p.reporter)].filter(Boolean);
}
export function buildFindDupesArgs(p) {
    return [
        'find-dupes',
        p.root,
        ...flag('min-lines', p.minLines),
        ...flag('min-tokens', p.minTokens),
        ...flag('reporter', p.reporter),
    ].filter(Boolean);
}
export function buildTraceExportArgs(p) {
    return ['trace-export', p.root, p.exportName, p.filePath].filter(Boolean);
}
export function buildTraceFileArgs(p) {
    return ['trace-file', p.root, p.filePath].filter(Boolean);
}
export function buildTraceDependencyArgs(p) {
    return ['trace-dependency', p.root, p.from, p.to].filter(Boolean);
}
export function buildTraceCloneArgs(p) {
    return ['trace-clone', p.root, ...flag('group-id', p.groupId)].filter(Boolean);
}
export function buildProjectInfoArgs(p) {
    return ['project-info', p.root, ...flag('reporter', p.reporter)].filter(Boolean);
}
export function buildFeatureFlagsArgs(p) {
    return ['feature-flags', p.root, ...flag('reporter', p.reporter)].filter(Boolean);
}
export function buildListBoundariesArgs(p) {
    return ['list-boundaries', p.root, ...flag('reporter', p.reporter)].filter(Boolean);
}
export function buildCheckRuntimeCoverageArgs(p) {
    return ['check-runtime-coverage', p.root, ...flag('reporter', p.reporter), ...flag('min-confidence', p.minConfidence)].filter(Boolean);
}
export function buildCheckChangedArgs(p) {
    return [
        'check',
        p.root,
        ...flag('changed-since', p.gitRef),
        ...flag('workspace', p.workspace),
        ...flag('include-entry-files', p.includeEntryFiles),
        ...flag('filter', p.filters),
    ].filter(Boolean);
}
export function buildFixPreviewArgs(p) {
    return [
        'fix',
        p.root,
        '--dry-run',
        ...flag('unused', p.filterUnused),
        ...flag('deps', p.filterDeps),
    ].filter(Boolean);
}
export function buildFixApplyArgs(p) {
    return [
        'fix',
        p.root,
        ...flag('unused', p.filterUnused),
        ...flag('deps', p.filterDeps),
    ].filter(Boolean);
}
export function buildExplainArgs(p) {
    return ['explain', p.ruleId, ...flag('verbose', p.verbose)].filter(Boolean);
}
export function buildGetHotPathsArgs(p) {
    return [
        'get-hot-paths', p.root,
        ...flag('min-requests-per-day', p.minRequestsPerDay),
        ...flag('limit', p.limit),
    ].filter(Boolean);
}
export function buildGetBlastRadiusArgs(p) {
    return [
        'get-blast-radius', p.root, p.filePath,
        ...flag('limit', p.limit),
    ].filter(Boolean);
}
export function buildGetImportanceArgs(p) {
    return [
        'get-importance', p.root,
        ...flag('limit', p.limit),
        ...flag('min-score', p.minScore),
    ].filter(Boolean);
}
export function buildGetCleanupCandidatesArgs(p) {
    return [
        'get-cleanup-candidates', p.root,
        ...flag('max-coverage-pct', p.maxCoveragePct),
        ...flag('limit', p.limit),
    ].filter(Boolean);
}
//# sourceMappingURL=tool-builders.js.map