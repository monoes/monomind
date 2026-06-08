export function resolveAnalyses(opts) {
    let result = new Set(['dead-code', 'duplication', 'health']);
    if (opts.skip) {
        for (const kind of opts.skip) {
            result.delete(kind);
        }
    }
    if (opts.only && opts.only.length > 0) {
        const onlySet = new Set(opts.only);
        result = new Set([...result].filter((k) => onlySet.has(k)));
    }
    return result;
}
export async function runCombined(db, opts) {
    const analyses = resolveAnalyses(opts);
    const ranAt = new Date().toISOString();
    return { analyses, ranAt };
}
//# sourceMappingURL=combined.js.map