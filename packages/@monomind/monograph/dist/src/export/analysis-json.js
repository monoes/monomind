// Schema-versioned JSON envelope builders for CLI analysis results.
export const ANALYSIS_JSON_SCHEMA_VERSION = 1;
export function buildAnalysisResultsEnvelope(results, totalIssues, opts = {}) {
    return {
        schemaVersion: opts.schemaVersion ?? ANALYSIS_JSON_SCHEMA_VERSION,
        kind: 'analysis',
        elapsedMs: opts.elapsedMs ?? 0,
        entryCount: opts.entryCount ?? 0,
        totalIssues,
        results,
    };
}
export function buildHealthResultsEnvelope(results, totalFindings, opts = {}) {
    return {
        schemaVersion: opts.schemaVersion ?? ANALYSIS_JSON_SCHEMA_VERSION,
        kind: 'health',
        elapsedMs: opts.elapsedMs ?? 0,
        totalFindings,
        includesExplanations: opts.includesExplanations ?? false,
        results,
    };
}
export function buildDuplicationResultsEnvelope(results, cloneGroups, opts = {}) {
    return {
        schemaVersion: opts.schemaVersion ?? ANALYSIS_JSON_SCHEMA_VERSION,
        kind: 'duplication',
        elapsedMs: opts.elapsedMs ?? 0,
        cloneGroups,
        includesExplanations: opts.includesExplanations ?? false,
        results,
    };
}
export function stripRootPrefix(obj, rootPrefix) {
    const json = JSON.stringify(obj);
    const escaped = rootPrefix.replace(/[/\\]/g, s => `\\${s}`);
    return JSON.parse(json.replace(new RegExp(escaped, 'g'), ''));
}
//# sourceMappingURL=analysis-json.js.map