// Serialize grouped health/duplication results and baseline-delta summaries to JSON.
export const DEFAULT_HEALTH_ACTION_OPTIONS = {
    includeRecommendedActions: true,
    includePerFileFindings: true,
};
export function buildGroupedHealthJson(groups, opts = DEFAULT_HEALTH_ACTION_OPTIONS) {
    const payload = groups.map(g => ({
        owner: g.owner,
        fileCount: g.fileCount,
        averageScore: g.averageScore,
        ...(opts.includePerFileFindings ? { findings: g.findings } : {}),
        ...(opts.includeRecommendedActions ? { recommendedAction: g.averageScore < 50 ? 'refactor' : 'monitor' } : {}),
    }));
    return JSON.stringify(payload, null, 2);
}
export function buildGroupedDuplicationJson(groups) {
    return JSON.stringify(groups, null, 2);
}
export function buildBaselineDeltasJson(current, baseline) {
    const deltas = Object.keys({ ...current, ...baseline }).map(metric => {
        const b = baseline[metric] ?? 0;
        const c = current[metric] ?? 0;
        const delta = c - b;
        return {
            metric,
            baseline: b,
            current: c,
            delta,
            deltaSign: delta > 0 ? '+' : delta < 0 ? '-' : '=',
        };
    });
    return JSON.stringify({ deltas, summary: { improved: deltas.filter(d => d.delta < 0).length, regressed: deltas.filter(d => d.delta > 0).length, unchanged: deltas.filter(d => d.delta === 0).length } }, null, 2);
}
//# sourceMappingURL=json-builders.js.map