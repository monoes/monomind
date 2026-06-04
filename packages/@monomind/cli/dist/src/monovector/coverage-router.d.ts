/**
 * Coverage-Aware Routing (ADR-017)
 *
 * Reads real test-coverage data from disk (Jest/Istanbul `coverage-summary.json`,
 * `lcov.info`, or nyc `out.json`), finds files below a coverage threshold, assigns
 * each gap to an appropriate agent, and produces routing/suggestion decisions.
 *
 * Pure, dependency-light: no native packages, no network. Used by the
 * `monomind route coverage` CLI command and the `coverage_*` MCP tools.
 *
 * @module @monomind/cli/monovector/coverage-router
 */
/** Per-file coverage percentages (0–100). */
export interface CoverageEntry {
    filePath: string;
    lines: number;
    branches: number;
    functions: number;
    statements: number;
}
export interface CoverageSummary {
    totalFiles: number;
    overallLineCoverage: number;
    overallBranchCoverage: number;
    overallFunctionCoverage: number;
    overallStatementCoverage: number;
}
export interface CoverageData {
    found: boolean;
    source: string;
    entries: CoverageEntry[];
    summary: CoverageSummary;
}
/** A single file below threshold, with its assigned agent. */
export interface CoverageGap {
    file: string;
    currentCoverage: number;
    gap: number;
    suggestedAgent: string;
}
export interface CoverageGapsResult {
    found: boolean;
    totalGaps: number;
    summary: string;
    byAgent: Record<string, string[]>;
    gaps: CoverageGap[];
}
export interface CoverageSuggestion {
    file: string;
    currentCoverage: number;
    targetCoverage: number;
    priority: number;
    suggestedTests: string[];
}
export interface CoverageSuggestResult {
    found: boolean;
    path: string;
    totalGap: number;
    estimatedEffort: number;
    suggestions: CoverageSuggestion[];
}
export type CoverageAction = 'add-tests' | 'review-coverage' | 'prioritize' | 'skip';
export interface CoverageRouteResult {
    found: boolean;
    action: CoverageAction;
    priority: number;
    impactScore: number;
    estimatedEffort: number;
    testTypes: string[];
    targetFiles: string[];
    gaps: Array<{
        file: string;
        currentCoverage: number;
        gap: number;
    }>;
}
interface CoverageOptions {
    threshold?: number;
}
/**
 * Read coverage data from disk. Checks, in order:
 *  1. coverage/coverage-summary.json  (Jest/Istanbul)
 *  2. coverage-summary.json           (repo root)
 *  3. coverage/lcov.info / lcov.info  (lcov)
 *  4. .nyc_output/out.json            (nyc)
 * Returns `{ found: false }` when no coverage report exists.
 */
export declare function readCoverage(cwd?: string): CoverageData;
/** Assign a coverage gap to the most appropriate agent based on file path. */
export declare function assignAgent(filePath: string): string;
/** List coverage gaps below threshold, grouped by assigned agent. */
export declare function coverageGaps(opts?: CoverageOptions & {
    groupByAgent?: boolean;
    path?: string;
}): Promise<CoverageGapsResult>;
/** Suggest concrete coverage improvements for a path. */
export declare function coverageSuggest(path?: string, opts?: CoverageOptions & {
    limit?: number;
}): Promise<CoverageSuggestResult>;
/** Produce a coverage-aware routing decision. */
export declare function coverageRoute(path?: string, opts?: CoverageOptions): Promise<CoverageRouteResult>;
export {};
//# sourceMappingURL=coverage-router.d.ts.map