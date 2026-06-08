export declare const LARGE_FUNCTION_LOC_THRESHOLD = 60;
export declare const LARGE_FUNCTION_REPORT_THRESHOLD_PCT = 0.03;
export interface LargeFunctionEntry {
    path: string;
    functionName: string;
    lineCount: number;
    startLine: number;
}
export declare function shouldReportLargeFunctions(veryHighCount: number, totalFunctions: number): boolean;
export declare function detectLargeFunctions(functions: Array<{
    path: string;
    name: string;
    loc: number;
    startLine: number;
}>, threshold?: number): LargeFunctionEntry[];
//# sourceMappingURL=large-functions.d.ts.map