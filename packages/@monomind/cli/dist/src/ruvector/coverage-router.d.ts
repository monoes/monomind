/**
 * Coverage Router for Test Routing
 *
 * Optimizations:
 * - Async file I/O for non-blocking coverage loading
 * - TTL-based caching of coverage data
 * - Singleton router instance
 */
/**
 * Clear coverage cache
 */
export declare function clearCoverageCache(): void;
/**
 * Get coverage cache stats
 */
export declare function getCoverageCacheStats(): {
    size: number;
};
export interface CoverageRouterConfig {
    minCoverage: number;
    targetCoverage: number;
    incremental: boolean;
    coverageTypes: ('line' | 'branch' | 'function' | 'statement')[];
}
export interface FileCoverage {
    path: string;
    lineCoverage: number;
    branchCoverage: number;
    functionCoverage: number;
    statementCoverage: number;
    uncoveredLines: number[];
    totalLines: number;
    coveredLines: number;
}
export interface CoverageReport {
    overall: number;
    byType: {
        line: number;
        branch: number;
        function: number;
        statement: number;
    };
    byFile: FileCoverage[];
    lowestCoverage: FileCoverage[];
    highestCoverage: FileCoverage[];
    uncoveredCritical: string[];
    timestamp: number;
}
export interface CoverageRouteResult {
    action: 'add-tests' | 'review-coverage' | 'skip' | 'prioritize';
    priority: number;
    targetFiles: string[];
    testTypes: ('unit' | 'integration' | 'e2e')[];
    gaps: Array<{
        file: string;
        currentCoverage: number;
        targetCoverage: number;
        gap: number;
        suggestedTests: string[];
    }>;
    estimatedEffort: number;
    impactScore: number;
}
export declare class CoverageRouter {
    private config;
    private ruvectorEngine;
    private useNative;
    private coverageHistory;
    constructor(config?: Partial<CoverageRouterConfig>);
    initialize(): Promise<void>;
    parseCoverage(data: unknown, format?: 'lcov' | 'istanbul' | 'cobertura' | 'json'): CoverageReport;
    route(coverage: CoverageReport, changedFiles?: string[]): CoverageRouteResult;
    getTrend(): {
        direction: 'up' | 'down' | 'stable';
        change: number;
    };
    addToHistory(report: CoverageReport): void;
    getStats(): Record<string, number | boolean>;
    private parseLcov;
    private parseIstanbul;
    private parseCobertura;
    private parseJson;
    private finalizeFileCoverage;
    private buildReport;
    private findCriticalUncovered;
    private calculateGaps;
    private suggestTests;
    private prioritizeFiles;
    private determineAction;
    private calculatePriority;
    private recommendTestTypes;
    private estimateEffort;
    private calculateImpact;
}
export declare function createCoverageRouter(config?: Partial<CoverageRouterConfig>): CoverageRouter;
/**
 * Coverage suggestion result
 */
export interface CoverageSuggestResult {
    path: string;
    suggestions: Array<{
        file: string;
        currentCoverage: number;
        targetCoverage: number;
        gap: number;
        priority: number;
        suggestedTests: string[];
    }>;
    totalGap: number;
    estimatedEffort: number;
}
/**
 * Coverage gaps result
 */
export interface CoverageGapsResult {
    totalGaps: number;
    gaps: Array<{
        file: string;
        currentCoverage: number;
        targetCoverage: number;
        gap: number;
        priority: number;
        suggestedAgent: string;
    }>;
    byAgent: Record<string, string[]>;
    summary: string;
}
/**
 * Coverage route options
 */
export interface CoverageRouteOptions {
    projectRoot?: string;
    threshold?: number;
    useRuvector?: boolean;
}
/**
 * Coverage suggest options
 */
export interface CoverageSuggestOptions extends CoverageRouteOptions {
    limit?: number;
}
/**
 * Coverage gaps options
 */
export interface CoverageGapsOptions extends CoverageRouteOptions {
    groupByAgent?: boolean;
}
/**
 * Route a task based on coverage analysis
 */
export declare function coverageRoute(task: string, options?: CoverageRouteOptions): Promise<CoverageRouteResult>;
/**
 * Suggest coverage improvements for a path
 */
export declare function coverageSuggest(path: string, options?: CoverageSuggestOptions): Promise<CoverageSuggestResult>;
/**
 * List all coverage gaps with agent assignments
 */
export declare function coverageGaps(options?: CoverageGapsOptions): Promise<CoverageGapsResult>;
//# sourceMappingURL=coverage-router.d.ts.map