import type Database from 'better-sqlite3';
export declare class Tolerance {
    private readonly pct;
    private readonly value;
    private constructor();
    /**
     * Parse a tolerance specification.
     * Accepts "2%" (percentage relative to baseline) or "5" (absolute count).
     * Throws if the spec is malformed or negative.
     */
    static parse(spec: string): Tolerance;
    /**
     * Returns true if the delta from baseline to current exceeds tolerance.
     * Only positive deltas (regressions) can violate tolerance.
     * Special case: if baseline is 0 and current > 0, percentage tolerance is always exceeded.
     */
    exceeded(baseline: number, current: number): boolean;
    toString(): string;
}
export interface RegressionMetric {
    metric: string;
    baseline: number;
    current: number;
    delta: number;
    tolerance: string;
    violated: boolean;
}
export interface RegressionOutcome {
    passed: boolean;
    violations: RegressionMetric[];
    checkedMetrics: RegressionMetric[];
    summary: string;
}
/**
 * Compare current DB state against a named baseline.
 *
 * @param db - better-sqlite3 Database instance
 * @param baselinePath - path to the baseline JSON file
 * @param toleranceSpec - e.g. "5%" or "10" — applied to ALL metrics unless metricTolerances provided
 * @param metricTolerances - per-metric tolerance overrides, e.g. { godNodeCount: "2", surpriseCount: "10%" }
 */
export declare function checkRegression(db: Database.Database, baselinePath: string, toleranceSpec: string, metricTolerances?: Record<string, string>): RegressionOutcome;
//# sourceMappingURL=regression.d.ts.map