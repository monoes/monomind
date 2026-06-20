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
/** Canonical metric names — defined once to avoid duplicating the same literal Set/Object. */
const METRIC_NAMES = Object.values(FINDING_TYPE_TO_METRIC);
const METRIC_NAME_SET = new Set(METRIC_NAMES);
/** Module-level cache for parsed Tolerance objects — avoids re-parsing identical specs. */
const toleranceCache = new Map();
function parseTolerance(spec) {
    let t = toleranceCache.get(spec);
    if (!t) {
        t = Tolerance.parse(spec);
        toleranceCache.set(spec, t);
    }
    return t;
}
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
    // Compute current counts from DB using shared METRIC_NAMES init
    const currentFindings = extractFindingsFromDb(db, '');
    const currentCounts = Object.fromEntries(METRIC_NAMES.map(m => [m, 0]));
    for (const f of currentFindings) {
        const metricName = FINDING_TYPE_TO_METRIC[f.type];
        if (metricName && METRIC_NAME_SET.has(metricName)) {
            currentCounts[metricName]++;
        }
    }
    // Compute baseline counts using shared METRIC_NAMES init
    const baselineCounts = Object.fromEntries(METRIC_NAMES.map(m => [m, 0]));
    if (baseline) {
        for (const f of baseline.findings) {
            const metricName = FINDING_TYPE_TO_METRIC[f.type];
            if (metricName && METRIC_NAME_SET.has(metricName)) {
                baselineCounts[metricName]++;
            }
        }
    }
    // Default tolerance — use cached parse to avoid rebuilding on repeated calls with same spec
    const defaultTolerance = parseTolerance(toleranceSpec);
    // Check each metric — per-metric tolerances also cached
    const checkedMetrics = [];
    for (const metric of METRIC_NAMES) {
        const baselineVal = baselineCounts[metric] ?? 0;
        const currentVal = currentCounts[metric] ?? 0;
        const delta = currentVal - baselineVal;
        const metricSpec = metricTolerances?.[metric];
        const tol = metricSpec ? parseTolerance(metricSpec) : defaultTolerance;
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
/**
 * Format a RegressionOutcome as structured text for LLM consumption.
 * Shows pass/fail status, per-metric results, and actionable violation details.
 */
export function formatRegressionOutcome(outcome) {
    const lines = [outcome.summary];
    lines.push('\nMetrics:');
    for (const m of outcome.checkedMetrics) {
        const sign = m.delta > 0 ? `+${m.delta}` : String(m.delta);
        const status = m.violated ? 'VIOLATED' : 'ok';
        lines.push(`  ${m.metric}: baseline=${m.baseline} current=${m.current} delta=${sign} tolerance=${m.tolerance} [${status}]`);
    }
    if (outcome.violations.length > 0) {
        lines.push('\nViolations requiring attention:');
        for (const v of outcome.violations) {
            const sign = v.delta > 0 ? `+${v.delta}` : String(v.delta);
            lines.push(`  ${v.metric} exceeded tolerance ${v.tolerance} (delta ${sign}): investigate new ${v.metric.replace(/Count$/, '')} introductions`);
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=regression.js.map