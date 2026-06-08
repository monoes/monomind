import { loadBaseline, extractFindingsFromDb } from './baseline.js';
// ── Tolerance ─────────────────────────────────────────────────────────────────
export class Tolerance {
    pct;
    value;
    constructor(pct, value) {
        this.pct = pct;
        this.value = value;
    }
    /**
     * Parse a tolerance specification.
     * Accepts "2%" (percentage relative to baseline) or "5" (absolute count).
     * Throws if the spec is malformed or negative.
     */
    static parse(spec) {
        if (!spec || typeof spec !== 'string') {
            throw new Error(`Invalid tolerance spec: "${spec}"`);
        }
        const trimmed = spec.trim();
        if (trimmed.endsWith('%')) {
            const raw = trimmed.slice(0, -1);
            const value = parseFloat(raw);
            if (isNaN(value) || value < 0) {
                throw new Error(`Invalid percentage tolerance: "${spec}"`);
            }
            return new Tolerance(true, value);
        }
        const value = parseFloat(trimmed);
        if (isNaN(value) || value < 0) {
            throw new Error(`Invalid absolute tolerance: "${spec}"`);
        }
        return new Tolerance(false, value);
    }
    /**
     * Returns true if the delta from baseline to current exceeds tolerance.
     * Only positive deltas (regressions) can violate tolerance.
     * Special case: if baseline is 0 and current > 0, percentage tolerance is always exceeded.
     */
    exceeded(baseline, current) {
        const delta = current - baseline;
        if (delta <= 0)
            return false; // improvement or stable — never violated
        if (this.pct) {
            if (baseline === 0)
                return true; // any increase from zero exceeds percentage tolerance
            const pctChange = (delta / baseline) * 100;
            return pctChange > this.value;
        }
        return delta > this.value;
    }
    toString() {
        return this.pct ? `${this.value}%` : String(this.value);
    }
}
// ── Finding type → metric name mapping ────────────────────────────────────────
const FINDING_TYPE_TO_METRIC = {
    god_node: 'godNodeCount',
    surprise: 'surpriseCount',
    bridge_node: 'bridgeNodeCount',
    unreachable_export: 'unreachableExportCount',
    ambiguous_edge: 'ambiguousEdgeCount',
};
// ── checkRegression ───────────────────────────────────────────────────────────
/**
 * Compare current DB state against a named baseline.
 *
 * @param db - better-sqlite3 Database instance
 * @param baselinePath - path to the baseline JSON file
 * @param toleranceSpec - e.g. "5%" or "10" — applied to ALL metrics unless metricTolerances provided
 * @param metricTolerances - per-metric tolerance overrides, e.g. { godNodeCount: "2", surpriseCount: "10%" }
 */
export function checkRegression(db, baselinePath, toleranceSpec, metricTolerances) {
    const baseline = loadBaseline(baselinePath);
    // Compute current counts from DB
    const currentFindings = extractFindingsFromDb(db, '');
    const currentCounts = {
        godNodeCount: 0,
        surpriseCount: 0,
        bridgeNodeCount: 0,
        unreachableExportCount: 0,
        ambiguousEdgeCount: 0,
    };
    for (const f of currentFindings) {
        const metricName = FINDING_TYPE_TO_METRIC[f.type];
        if (metricName && metricName in currentCounts) {
            currentCounts[metricName]++;
        }
    }
    // Compute baseline counts
    const baselineCounts = {
        godNodeCount: 0,
        surpriseCount: 0,
        bridgeNodeCount: 0,
        unreachableExportCount: 0,
        ambiguousEdgeCount: 0,
    };
    if (baseline) {
        for (const f of baseline.findings) {
            const metricName = FINDING_TYPE_TO_METRIC[f.type];
            if (metricName && metricName in baselineCounts) {
                baselineCounts[metricName]++;
            }
        }
    }
    // Default tolerance
    const defaultTolerance = Tolerance.parse(toleranceSpec);
    // Check each metric
    const checkedMetrics = [];
    for (const metric of Object.keys(currentCounts)) {
        const baselineVal = baselineCounts[metric] ?? 0;
        const currentVal = currentCounts[metric] ?? 0;
        const delta = currentVal - baselineVal;
        const metricSpec = metricTolerances?.[metric];
        const tol = metricSpec ? Tolerance.parse(metricSpec) : defaultTolerance;
        const tolStr = tol.toString();
        const violated = tol.exceeded(baselineVal, currentVal);
        checkedMetrics.push({
            metric,
            baseline: baselineVal,
            current: currentVal,
            delta,
            tolerance: tolStr,
            violated,
        });
    }
    const violations = checkedMetrics.filter(m => m.violated);
    const passed = violations.length === 0;
    const baselineName = baselinePath.split('/').pop()?.replace(/\.json$/, '') ?? baselinePath;
    const summary = passed
        ? `Regression check PASSED — no violations against baseline "${baselineName}" (tolerance: ${toleranceSpec})`
        : `Regression check FAILED — ${violations.length} violation(s) against baseline "${baselineName}" (tolerance: ${toleranceSpec})`;
    return { passed, violations, checkedMetrics, summary };
}
//# sourceMappingURL=regression.js.map