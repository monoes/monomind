export const LARGE_FUNCTION_LOC_THRESHOLD = 60;
export const LARGE_FUNCTION_REPORT_THRESHOLD_PCT = 0.03;
export function shouldReportLargeFunctions(veryHighCount, totalFunctions) {
    if (totalFunctions <= 0) {
        return false;
    }
    return veryHighCount / totalFunctions >= LARGE_FUNCTION_REPORT_THRESHOLD_PCT;
}
export function detectLargeFunctions(functions, threshold = LARGE_FUNCTION_LOC_THRESHOLD) {
    return functions
        .filter((f) => f.loc >= threshold)
        .sort((a, b) => b.loc - a.loc)
        .map((f) => ({
        path: f.path,
        functionName: f.name,
        lineCount: f.loc,
        startLine: f.startLine,
    }));
}
//# sourceMappingURL=large-functions.js.map