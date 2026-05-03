export type AnalysisEffort = 'low' | 'medium' | 'high';

export interface EffortProfile {
  runChurn: boolean;
  runOwnership: boolean;
  runHotspots: boolean;
  runFileScores: boolean;
  runSuffixArray: boolean;
  runCrossReference: boolean;
  maxFilesForExpensiveAnalysis: number;
}

const EFFORT_PROFILES: Record<AnalysisEffort, EffortProfile> = {
  low: {
    runChurn: false,
    runOwnership: false,
    runHotspots: false,
    runFileScores: true,
    runSuffixArray: false,
    runCrossReference: false,
    maxFilesForExpensiveAnalysis: 100,
  },
  medium: {
    runChurn: true,
    runOwnership: false,
    runHotspots: true,
    runFileScores: true,
    runSuffixArray: false,
    runCrossReference: true,
    maxFilesForExpensiveAnalysis: 500,
  },
  high: {
    runChurn: true,
    runOwnership: true,
    runHotspots: true,
    runFileScores: true,
    runSuffixArray: true,
    runCrossReference: true,
    maxFilesForExpensiveAnalysis: Infinity,
  },
};

export function getEffortProfile(effort: AnalysisEffort = 'medium'): EffortProfile {
  return EFFORT_PROFILES[effort];
}

export function parseEffort(s: string): AnalysisEffort {
  if (s === 'low' || s === 'medium' || s === 'high') return s;
  return 'medium';
}
