export interface PerFunctionCrap {
    functionName: string;
    crap: number;
    cyclomatic: number;
    coveragePct: number;
    line?: number;
}
export interface CoverageGapData {
    filePath: string;
    coveragePct: number;
    coveredLines: number;
    totalLines: number;
    uncoveredFunctions: string[];
}
export interface FileScoreBundle {
    filePath: string;
    fanIn: number;
    fanOut: number;
    maintainabilityIndex?: number;
    complexityDensity: number;
    churnScore?: number;
    perFunctionCrap: PerFunctionCrap[];
    coverageGap?: CoverageGapData;
    lineCount: number;
    inCycle: boolean;
    deadCodeRatio: number;
}
export declare function computeComplexityDensity(totalCyclomatic: number, lineCount: number): number;
export declare function computeDeadCodeRatio(unusedExports: number, totalExports: number): number;
export declare function computeMaintainabilityIndex(halsteadVolume: number, cyclomaticComplexity: number, lineCount: number): number;
//# sourceMappingURL=scoring-types.d.ts.map