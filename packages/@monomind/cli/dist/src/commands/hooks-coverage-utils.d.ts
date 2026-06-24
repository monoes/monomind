/**
 * Coverage utilities for hooks commands.
 * Extracted from hooks.ts (ARCH-1) — reads Jest/Istanbul/lcov coverage files from disk.
 */
export interface CoverageFileEntry {
    filePath: string;
    lines: number;
    branches: number;
    functions: number;
    statements: number;
}
export interface CoverageData {
    found: boolean;
    source: string;
    entries: CoverageFileEntry[];
    summary: {
        totalFiles: number;
        overallLineCoverage: number;
        overallBranchCoverage: number;
        overallFunctionCoverage: number;
        overallStatementCoverage: number;
    };
}
/**
 * Read coverage data from disk. Checks these locations in order:
 * 1. coverage/coverage-summary.json (Jest/Istanbul)
 * 2. coverage/lcov.info (lcov format)
 * 3. .nyc_output/out.json (nyc)
 */
export declare function readCoverageFromDisk(): CoverageData;
/**
 * Classify a coverage gap by priority type based on coverage percentage and threshold
 */
export declare function classifyCoverageGap(coveragePct: number, threshold: number): {
    gapType: string;
    priority: number;
};
/**
 * Suggest agents for a file based on its path
 */
export declare function suggestAgentsForFile(filePath: string): string[];
//# sourceMappingURL=hooks-coverage-utils.d.ts.map