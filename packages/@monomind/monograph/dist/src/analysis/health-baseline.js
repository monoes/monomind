function toRelativePath(filePath, root) {
    const normalized = filePath.replace(/\\/g, '/');
    const rootNorm = root.replace(/\\/g, '/').replace(/\/$/, '') + '/';
    return normalized.startsWith(rootNorm) ? normalized.slice(rootNorm.length) : normalized;
}
function buildCountsFromFindings(findings, root) {
    const map = new Map();
    const zero = () => ({
        complexityModerate: 0, complexityHigh: 0, complexityCritical: 0,
        crapModerate: 0, crapHigh: 0, crapCritical: 0,
    });
    for (const f of findings) {
        const key = toRelativePath(f.filePath, root);
        const counts = map.get(key) ?? zero();
        const fieldMap = {
            'complexity_moderate': 'complexityModerate',
            'complexity_high': 'complexityHigh',
            'complexity_critical': 'complexityCritical',
            'crap_moderate': 'crapModerate',
            'crap_high': 'crapHigh',
            'crap_critical': 'crapCritical',
        };
        const field = fieldMap[f.kind];
        if (field)
            counts[field]++;
        map.set(key, counts);
    }
    return map;
}
export function buildHealthBaseline(findings, root) {
    return { counts: buildCountsFromFindings(findings, root) };
}
export function filterNewHealthFindings(current, baseline, root) {
    // Build counts from CURRENT findings (not the baseline) to compare per-kind per-file
    const currentCounts = buildCountsFromFindings(current, root);
    return current.filter(f => {
        const key = toRelativePath(f.filePath, root);
        const saved = baseline.counts.get(key);
        if (!saved)
            return true;
        const fieldMap = {
            'complexity_moderate': 'complexityModerate',
            'complexity_high': 'complexityHigh',
            'complexity_critical': 'complexityCritical',
            'crap_moderate': 'crapModerate',
            'crap_high': 'crapHigh',
            'crap_critical': 'crapCritical',
        };
        const field = fieldMap[f.kind];
        if (!field)
            return true;
        const currentCount = currentCounts.get(key)?.[field] ?? 0;
        const savedCount = saved[field];
        return currentCount > savedCount;
    });
}
//# sourceMappingURL=health-baseline.js.map