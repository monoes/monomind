import {
  type Confidence,
  type EffortEstimate,
  type RecommendationCategory,
  type RefactoringTarget,
  type TargetThresholds,
} from './target-types.js';

export interface FileScoreInput {
  filePath: string;
  fanIn: number;
  fanOut: number;
  churnScore?: number;
  complexity?: number;
  deadCodeRatio?: number;
  inCycle?: boolean;
  coveragePct?: number;
  lineCount?: number;
}

function percentileFromSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.min(Math.max(idx, 0), sorted.length - 1)];
}

export function computeThresholds(files: FileScoreInput[]): TargetThresholds {
  if (files.length === 0) {
    return { fanInP95: 5, fanInP75: 3, fanInP25: 2, fanOutP95: 8, fanOutP90: 5 };
  }

  const fanIns = [...files.map(f => f.fanIn)].sort((a, b) => a - b);
  const fanOuts = [...files.map(f => f.fanOut)].sort((a, b) => a - b);

  return {
    fanInP95: Math.max(5, percentileFromSorted(fanIns, 0.95)),
    fanInP75: Math.max(3, percentileFromSorted(fanIns, 0.75)),
    fanInP25: Math.max(2, percentileFromSorted(fanIns, 0.25)),
    fanOutP95: Math.max(8, percentileFromSorted(fanOuts, 0.95)),
    fanOutP90: Math.max(5, percentileFromSorted(fanOuts, 0.90)),
  };
}

function computePriority(
  file: FileScoreInput,
  thresholds: TargetThresholds,
): number {
  const densityNorm = Math.min(file.complexity ?? 0, 1.0);
  const fanInNorm = Math.min(file.fanIn / thresholds.fanInP95, 1.0);
  const fanOutNorm = Math.min(file.fanOut / thresholds.fanOutP95, 1.0);
  const hotspotBoost = file.churnScore != null ? Math.min(file.churnScore / 100, 1.0) : 0;
  const deadCode = file.deadCodeRatio ?? 0;

  const priority =
    densityNorm * 30 +
    hotspotBoost * 25 +
    deadCode * 20 +
    fanInNorm * 15 +
    fanOutNorm * 10;

  return Math.round(Math.min(Math.max(priority, 0), 100) * 10) / 10;
}

function confidenceForCategory(category: RecommendationCategory): Confidence {
  switch (category) {
    case 'RemoveDeadCode':
    case 'BreakCircularDependency':
    case 'ExtractComplexFunctions':
    case 'AddTestCoverage':
      return 'High';
    case 'SplitHighImpact':
    case 'ExtractDependencies':
      return 'Medium';
    case 'UrgentChurnComplexity':
      return 'Low';
  }
}

function effortForFile(file: FileScoreInput, thresholds: TargetThresholds): EffortEstimate {
  const lines = file.lineCount ?? 0;
  if (lines >= 500 || file.fanIn >= thresholds.fanInP95) return 'High';
  if (lines < 100 && file.fanIn < thresholds.fanInP25) return 'Low';
  return 'Medium';
}

function effortNumeric(effort: EffortEstimate): number {
  switch (effort) {
    case 'Low': return 1;
    case 'Medium': return 2;
    case 'High': return 3;
    case 'VeryHigh': return 4;
  }
}

function matchRule(
  file: FileScoreInput,
  thresholds: TargetThresholds,
): RecommendationCategory | null {
  const churn = file.churnScore ?? 0;
  const complexity = file.complexity ?? 0;
  const deadCode = file.deadCodeRatio ?? 0;
  const coverage = file.coveragePct ?? 100;

  if (churn >= 50 && complexity > 0.5) return 'UrgentChurnComplexity';
  if (file.inCycle && file.fanIn >= 5) return 'BreakCircularDependency';
  if (complexity > 0.3 && file.fanIn >= thresholds.fanInP95) return 'SplitHighImpact';
  if (deadCode > 0.3) return 'RemoveDeadCode';
  if (complexity > 0.3) return 'ExtractComplexFunctions';
  if (file.fanOut > thresholds.fanOutP95) return 'ExtractDependencies';
  if (coverage < 50) return 'AddTestCoverage';
  if (file.inCycle) return 'BreakCircularDependency';
  return null;
}

export function computeRefactoringTargets(
  files: FileScoreInput[],
  thresholds: TargetThresholds,
  maxTargets = 20,
): RefactoringTarget[] {
  const results: Array<RefactoringTarget & { efficiency: number }> = [];

  for (const file of files) {
    const category = matchRule(file, thresholds);
    if (category == null) continue;

    const priority = computePriority(file, thresholds);
    const effort = effortForFile(file, thresholds);
    const confidence = confidenceForCategory(category);
    const efficiency = priority / effortNumeric(effort);

    results.push({
      filePath: file.filePath,
      category,
      priority,
      confidence,
      effort,
      factors: [],
      description: category,
      estimatedLines: file.lineCount,
      efficiency,
    });
  }

  results.sort((a, b) => {
    const diff = b.efficiency - a.efficiency;
    if (diff !== 0) return diff;
    return b.priority - a.priority;
  });

  return results.slice(0, maxTargets).map(({ efficiency: _eff, ...rest }) => rest);
}
