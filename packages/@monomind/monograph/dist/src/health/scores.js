export const HIGH_COVERAGE_WATERMARK = 70.0;
export function coverageTierFromPct(pct) {
    if (pct <= 0)
        return 'none';
    if (pct >= HIGH_COVERAGE_WATERMARK)
        return 'high';
    return 'partial';
}
export function exceededThresholdFromBools(cyclomatic, cognitive, crap) {
    if (cyclomatic && cognitive && crap)
        return 'all';
    if (cyclomatic && cognitive)
        return 'both';
    if (cyclomatic && crap)
        return 'cyclomatic_crap';
    if (cognitive && crap)
        return 'cognitive_crap';
    if (cyclomatic)
        return 'cyclomatic';
    if (cognitive)
        return 'cognitive';
    if (crap)
        return 'crap';
    throw new Error('at least one threshold must be exceeded');
}
export function includesCyclomatic(t) {
    return ['cyclomatic', 'both', 'cyclomatic_crap', 'all'].includes(t);
}
export function includesCognitive(t) {
    return ['cognitive', 'both', 'cognitive_crap', 'all'].includes(t);
}
export function includesCrap(t) {
    return ['crap', 'cyclomatic_crap', 'cognitive_crap', 'all'].includes(t);
}
export const DEFAULT_CRAP_HIGH = 50.0;
export const DEFAULT_CRAP_CRITICAL = 100.0;
export const DEFAULT_COGNITIVE_HIGH = 25;
export const DEFAULT_COGNITIVE_CRITICAL = 40;
export const DEFAULT_CYCLOMATIC_HIGH = 30;
export const DEFAULT_CYCLOMATIC_CRITICAL = 50;
export function computeFindingSeverity(opts) {
    const { cognitive, cyclomatic, crap, cognitiveHigh = DEFAULT_COGNITIVE_HIGH, cognitiveCritical = DEFAULT_COGNITIVE_CRITICAL, cyclomaticHigh = DEFAULT_CYCLOMATIC_HIGH, cyclomaticCritical = DEFAULT_CYCLOMATIC_CRITICAL, } = opts;
    const cogSev = cognitive >= cognitiveCritical ? 'critical' : cognitive >= cognitiveHigh ? 'high' : 'moderate';
    const cycSev = cyclomatic >= cyclomaticCritical ? 'critical' : cyclomatic >= cyclomaticHigh ? 'high' : 'moderate';
    const crapSev = crap === undefined ? 'moderate' : crap >= DEFAULT_CRAP_CRITICAL ? 'critical' : crap >= DEFAULT_CRAP_HIGH ? 'high' : 'moderate';
    const order = ['moderate', 'high', 'critical'];
    return [cogSev, cycSev, crapSev].reduce((a, b) => order.indexOf(a) >= order.indexOf(b) ? a : b);
}
//# sourceMappingURL=scores.js.map