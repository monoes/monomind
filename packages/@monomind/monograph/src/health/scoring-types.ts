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

export function computeComplexityDensity(totalCyclomatic: number, lineCount: number): number {
  return totalCyclomatic / Math.max(lineCount, 1);
}

export function computeDeadCodeRatio(unusedExports: number, totalExports: number): number {
  return Math.min(unusedExports / Math.max(totalExports, 1), 1.0);
}

export function computeMaintainabilityIndex(
  halsteadVolume: number,
  cyclomaticComplexity: number,
  lineCount: number,
): number {
  const v = Math.max(halsteadVolume, 1);
  const loc = Math.max(lineCount, 1);
  const mi = 171 - 5.2 * Math.log(v) - 0.23 * cyclomaticComplexity - 16.2 * Math.log(loc);
  return Math.min(Math.max(mi, 0), 100);
}
