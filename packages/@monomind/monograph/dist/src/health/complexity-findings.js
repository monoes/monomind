// Rich per-function complexity finding types with CRAP score support,
// coverage tiering, and severity classification.
export function coverageTierFromPct(pct) {
    if (pct >= 80)
        return 'high';
    if (pct > 0)
        return 'partial';
    return 'none';
}
export const DEFAULT_CYCLOMATIC_HIGH = 10;
export const DEFAULT_CYCLOMATIC_CRITICAL = 20;
export const DEFAULT_COGNITIVE_HIGH = 15;
export const DEFAULT_COGNITIVE_CRITICAL = 30;
export const DEFAULT_CRAP_HIGH = 30;
export const DEFAULT_CRAP_CRITICAL = 100;
export const COGNITIVE_EXTRACTION_THRESHOLD = 5;
export function classifyFindingSeverity(cyclomatic, cognitive, crap, opts = {}) {
    const ch = opts.cyclomaticHigh ?? DEFAULT_CYCLOMATIC_HIGH;
    const cc = opts.cyclomaticCritical ?? DEFAULT_CYCLOMATIC_CRITICAL;
    const kh = opts.cognitiveHigh ?? DEFAULT_COGNITIVE_HIGH;
    const kc = opts.cognitiveCritical ?? DEFAULT_COGNITIVE_CRITICAL;
    const rh = opts.crapHigh ?? DEFAULT_CRAP_HIGH;
    const rc = opts.crapCritical ?? DEFAULT_CRAP_CRITICAL;
    if (cyclomatic >= cc || cognitive >= kc || crap >= rc)
        return 'critical';
    if (cyclomatic >= ch || cognitive >= kh || crap >= rh)
        return 'high';
    return 'moderate';
}
export function summarizeFindings(findings) {
    const counts = { moderate: 0, high: 0, critical: 0 };
    let totalCrap = 0;
    for (const f of findings) {
        counts[f.severity]++;
        totalCrap += f.crapScore;
    }
    return {
        totalFunctions: findings.length,
        moderateCount: counts.moderate,
        highCount: counts.high,
        criticalCount: counts.critical,
        averageCrapScore: findings.length > 0 ? totalCrap / findings.length : 0,
        istanbulCoverageAvailable: findings.some(f => f.coverageTier !== 'none'),
        coverageModel: 'staticBinary',
        thresholdCyclomaticHigh: DEFAULT_CYCLOMATIC_HIGH,
        thresholdCyclomaticCritical: DEFAULT_CYCLOMATIC_CRITICAL,
        thresholdCognitiveHigh: DEFAULT_COGNITIVE_HIGH,
        thresholdCognitiveCritical: DEFAULT_COGNITIVE_CRITICAL,
        thresholdCrapHigh: DEFAULT_CRAP_HIGH,
        thresholdCrapCritical: DEFAULT_CRAP_CRITICAL,
    };
}
//# sourceMappingURL=complexity-findings.js.map