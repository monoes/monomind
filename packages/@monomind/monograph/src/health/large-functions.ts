export const LARGE_FUNCTION_LOC_THRESHOLD = 60;
export const LARGE_FUNCTION_REPORT_THRESHOLD_PCT = 0.03;

export interface LargeFunctionEntry {
  path: string;
  functionName: string;
  lineCount: number;
  startLine: number;
}

export function shouldReportLargeFunctions(
  veryHighCount: number,
  totalFunctions: number
): boolean {
  if (totalFunctions <= 0) {
    return false;
  }
  return veryHighCount / totalFunctions >= LARGE_FUNCTION_REPORT_THRESHOLD_PCT;
}

export function detectLargeFunctions(
  functions: Array<{ path: string; name: string; loc: number; startLine: number }>,
  threshold = LARGE_FUNCTION_LOC_THRESHOLD
): LargeFunctionEntry[] {
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
