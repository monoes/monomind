export interface TargetThresholds {
  fanInP95: number;
  fanInP75: number;
  fanInP25: number;
  fanOutP95: number;
  fanOutP90: number;
}

export type RecommendationCategory =
  | 'UrgentChurnComplexity'
  | 'BreakCircularDependency'
  | 'SplitHighImpact'
  | 'RemoveDeadCode'
  | 'ExtractComplexFunctions'
  | 'ExtractDependencies'
  | 'AddTestCoverage';

export type ContributingFactor =
  | 'HighChurn'
  | 'HighComplexity'
  | 'HighFanIn'
  | 'HighFanOut'
  | 'InCycle'
  | 'HasDeadCode'
  | 'LowCoverage'
  | 'HeavyDependencies';

export type EffortEstimate = 'Low' | 'Medium' | 'High' | 'VeryHigh';

export type Confidence = 'Low' | 'Medium' | 'High';

export interface RefactoringTarget {
  filePath: string;
  category: RecommendationCategory;
  priority: number;
  confidence: Confidence;
  effort: EffortEstimate;
  factors: ContributingFactor[];
  description: string;
  estimatedLines?: number;
}

export function computeEffortFromLines(lines: number): EffortEstimate {
  if (lines < 50) return 'Low';
  if (lines < 200) return 'Medium';
  if (lines < 500) return 'High';
  return 'VeryHigh';
}

export function computeConfidenceFromFactors(factorCount: number): Confidence {
  if (factorCount === 1) return 'Low';
  if (factorCount <= 3) return 'Medium';
  return 'High';
}
